import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

/**
 * The on-disk contract, shared with the Rain Log Omarchy plugin:
 *
 *   { "entries": { "YYYY-MM-DD": <integer tenths of an inch> } }
 *
 * Values are integers, positive, and a missing key means "no rain recorded".
 * The plugin rewrites this whole file from memory whenever it saves, so this
 * server must never rely on extra top-level keys surviving. Web-only state
 * lives in rainlog-web.json.
 */

export const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
export const MAX_TENTHS = 9999
export const DATA_FILE = 'rainlog.json'
export const PREFS_FILE = 'rainlog-web.json'
export const SNAPSHOT_DIR = '.rainlog-backups'
const SNAPSHOT_RE = /^rainlog-\d{8}-\d{9}-[a-z0-9-]+\.json$/

export interface RainlogFile {
  entries: Record<string, unknown>
  [key: string]: unknown
}

export interface DataSnapshot {
  exists: boolean
  text: string
  data: RainlogFile
  entries: Record<string, number>
  etag: string
  mtimeMs: number
  parseError: string | null
}

export interface Preferences {
  version: 1
  units: 'in' | 'mm'
  customDays: number
}

export interface SnapshotInfo {
  name: string
  size: number
  mtimeMs: number
  reason: string
}

export interface ConflictFileInfo {
  name: string
  size: number
  mtimeMs: number
}

export interface StatePayload {
  entries: Record<string, number>
  etag: string
  mtimeMs: number
  exists: boolean
  parseError: string | null
  prefs: Preferences
  conflicts: ConflictFileInfo[]
  serverTime: string
}

export interface ImportRejection {
  date: string
  value: unknown
  reason: string
}

export interface ImportReport {
  dryRun: boolean
  replaceAll: boolean
  added: number
  updated: number
  unchanged: number
  removed: number
  rejected: ImportRejection[]
  warnings: string[]
  total: number
  etag?: string
}

export interface SetEntryOptions {
  ifMatch?: string | undefined
  expectedPrevious?: number | null | undefined
  force?: boolean | undefined
}

export interface ImportOptions {
  replaceAll?: boolean | undefined
  dryRun?: boolean | undefined
  ifMatch?: string | undefined
  force?: boolean | undefined
}

export class ConflictError extends Error {
  constructor(public readonly current: DataSnapshot) {
    super('The data file changed since it was loaded')
    this.name = 'ConflictError'
  }
}

export class ValidationError extends Error {
  constructor(message: string, public readonly details?: unknown) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class CorruptDataError extends Error {
  constructor(public readonly parseError: string) {
    super('The data file is not valid JSON')
    this.name = 'CorruptDataError'
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

export const DEFAULT_PREFS: Preferences = { version: 1, units: 'in', customDays: 14 }

const prefsSchema = z.object({
  version: z.literal(1).optional(),
  units: z.enum(['in', 'mm']).default('in'),
  customDays: z.number().int().min(1).max(365).default(14),
})

export function etagFor(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function isRealDateKey(key: string): boolean {
  if (!DATE_KEY_RE.test(key)) return false
  const [ys, ms, ds] = key.split('-')
  const y = Number(ys)
  const m = Number(ms)
  const d = Number(ds)
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false
  if (y < 1900 || y > 2200) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** Lenient read, mirroring the plugin's parseInt behaviour. */
export function tolerantTenths(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return Math.trunc(value)
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

export function positiveEntries(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of Object.keys(raw).sort()) {
    if (!isRealDateKey(key)) continue
    const value = tolerantTenths(raw[key])
    if (value !== null && value > 0) out[key] = value
  }
  return out
}

export function serializeData(data: RainlogFile): string {
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(data.entries).sort()) sorted[key] = data.entries[key]
  return JSON.stringify({ ...data, entries: sorted }, null, 2)
}

function parseData(text: string): { data: RainlogFile; parseError: string | null } {
  const clean = text.replace(/^\uFEFF/, '')
  if (clean.trim() === '') return { data: { entries: {} }, parseError: null }
  try {
    const parsed: unknown = JSON.parse(clean)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { data: { entries: {} }, parseError: 'Top-level JSON value is not an object' }
    }
    const obj = parsed as Record<string, unknown>
    const entries = obj.entries
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      return { data: { entries: {} }, parseError: '"entries" is missing or is not an object' }
    }
    return {
      data: { ...obj, entries: entries as Record<string, unknown> },
      parseError: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { data: { entries: {} }, parseError: message }
  }
}

function timestamp(d = new Date()): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}`
  )
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function atomicWrite(target: string, text: string, fallbackMode = 0o664): Promise<void> {
  const dir = path.dirname(target)
  await fs.mkdir(dir, { recursive: true, mode: 0o775 })
  let mode = fallbackMode
  try {
    const stat = await fs.stat(target)
    mode = stat.mode & 0o777
  } catch {
    // New file; use the fallback mode.
  }
  const tmp = path.join(dir, `.${path.basename(target)}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`)
  const handle = await fs.open(tmp, 'wx', mode)
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.chmod(tmp, mode)
    await fs.rename(tmp, target)
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw error
  }
  // Persist the rename itself so a crash cannot leave a missing directory entry.
  try {
    const dirHandle = await fs.open(dir, 'r')
    try {
      await dirHandle.sync()
    } finally {
      await dirHandle.close()
    }
  } catch {
    // Directory fsync is not supported everywhere; the write is still atomic.
  }
}

export interface StoreOptions {
  dataDir: string
  snapshotRetention?: number
  snapshotIntervalSec?: number
}

export class RainlogStore {
  readonly dataDir: string
  readonly dataPath: string
  readonly prefsPath: string
  readonly snapshotDir: string
  private readonly snapshotRetention: number
  private readonly snapshotIntervalMs: number
  private queue: Promise<unknown> = Promise.resolve()
  private lastWrittenEtag: string | null = null
  private lastSnapshotAt = 0

  constructor(options: StoreOptions) {
    this.dataDir = path.resolve(options.dataDir)
    this.dataPath = path.join(this.dataDir, DATA_FILE)
    this.prefsPath = path.join(this.dataDir, PREFS_FILE)
    this.snapshotDir = path.join(this.dataDir, SNAPSHOT_DIR)
    this.snapshotRetention = Math.max(1, options.snapshotRetention ?? 100)
    this.snapshotIntervalMs = Math.max(0, options.snapshotIntervalSec ?? 3600) * 1000
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  async init(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o775 })
    await fs.mkdir(this.snapshotDir, { recursive: true, mode: 0o775 })
    if (!(await pathExists(this.dataPath))) {
      try {
        await fs.writeFile(this.dataPath, serializeData({ entries: {} }), {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o664,
        })
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EEXIST') throw error
      }
    }
    const current = await this.read()
    this.lastWrittenEtag = current.etag
    const snapshots = await this.listSnapshots()
    const newest = snapshots[0]
    if (newest) this.lastSnapshotAt = newest.mtimeMs
  }

  async read(): Promise<DataSnapshot> {
    let text = ''
    let mtimeMs = 0
    let exists = true
    try {
      const [fileText, stat] = await Promise.all([fs.readFile(this.dataPath, 'utf8'), fs.stat(this.dataPath)])
      text = fileText
      mtimeMs = stat.mtimeMs
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      exists = false
    }
    const { data, parseError } = parseData(text)
    return {
      exists,
      text,
      data,
      entries: positiveEntries(data.entries),
      etag: etagFor(text),
      mtimeMs,
      parseError,
    }
  }

  async readPrefs(): Promise<Preferences> {
    try {
      const text = await fs.readFile(this.prefsPath, 'utf8')
      const parsed = prefsSchema.safeParse(JSON.parse(text))
      if (!parsed.success) return { ...DEFAULT_PREFS }
      return {
        version: 1,
        units: parsed.data.units,
        customDays: parsed.data.customDays,
      }
    } catch {
      return { ...DEFAULT_PREFS }
    }
  }

  async writePrefs(input: unknown): Promise<Preferences> {
    const parsed = prefsSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError('Invalid preferences', parsed.error.flatten())
    }
    const prefs: Preferences = {
      version: 1,
      units: parsed.data.units,
      customDays: parsed.data.customDays,
    }
    await atomicWrite(this.prefsPath, JSON.stringify(prefs, null, 2), 0o664)
    return prefs
  }

  async listConflicts(): Promise<ConflictFileInfo[]> {
    const names = await fs.readdir(this.dataDir).catch(() => [] as string[])
    const conflicts: ConflictFileInfo[] = []
    for (const name of names) {
      if (!name.includes('.sync-conflict-') || !name.endsWith('.json')) continue
      try {
        const stat = await fs.stat(path.join(this.dataDir, name))
        conflicts.push({ name, size: stat.size, mtimeMs: stat.mtimeMs })
      } catch {
        // A file may disappear while it is being synced.
      }
    }
    return conflicts.sort((a, b) => b.mtimeMs - a.mtimeMs)
  }

  async state(): Promise<StatePayload> {
    const [snapshot, prefs, conflicts] = await Promise.all([this.read(), this.readPrefs(), this.listConflicts()])
    return {
      entries: snapshot.entries,
      etag: snapshot.etag,
      mtimeMs: snapshot.mtimeMs,
      exists: snapshot.exists,
      parseError: snapshot.parseError,
      prefs,
      conflicts,
      serverTime: new Date().toISOString(),
    }
  }

  async setEntry(date: string, tenths: number | null, options: SetEntryOptions = {}): Promise<DataSnapshot> {
    if (!isRealDateKey(date)) throw new ValidationError(`Invalid date: ${date}`)
    if (tenths !== null && (!Number.isInteger(tenths) || tenths < 1 || tenths > MAX_TENTHS)) {
      throw new ValidationError('Reading must be a whole number between 1 and 9999 tenths')
    }
    return this.exclusive(async () => {
      const current = await this.read()
      if (current.parseError && !options.force) throw new CorruptDataError(current.parseError)
      if (options.ifMatch && options.ifMatch !== current.etag) {
        const currentValue = tolerantTenths(current.data.entries[date])
        const currentPositive = currentValue !== null && currentValue > 0 ? currentValue : null
        const expected = options.expectedPrevious === undefined ? undefined : options.expectedPrevious
        const expectedPositive = typeof expected === 'number' && expected > 0 ? expected : null
        if (expected === undefined || currentPositive !== expectedPositive) {
          throw new ConflictError(current)
        }
      }
      await this.maybeExternalSnapshot(current)
      const entries = { ...current.data.entries }
      if (tenths === null) delete entries[date]
      else entries[date] = tenths
      const text = serializeData({ ...current.data, entries })
      await atomicWrite(this.dataPath, text)
      const written = await this.read()
      this.lastWrittenEtag = written.etag
      await this.maybeIntervalSnapshot(written)
      return written
    })
  }

  async importEntries(source: Record<string, unknown>, options: ImportOptions = {}): Promise<ImportReport> {
    const incoming = new Map<string, number | null>()
    const rejected: ImportRejection[] = []
    const warnings: string[] = []
    for (const [date, raw] of Object.entries(source)) {
      if (!isRealDateKey(date)) {
        rejected.push({ date, value: raw, reason: 'Date is not a valid YYYY-MM-DD calendar day' })
        continue
      }
      let normalized: number | null = null
      if (raw === null || raw === undefined || raw === '') {
        normalized = null
      } else if (typeof raw === 'number') {
        if (Number.isInteger(raw) && raw > 0 && raw <= MAX_TENTHS) normalized = raw
        else if (Number.isInteger(raw) && raw === 0) normalized = null
        else {
          rejected.push({ date, value: raw, reason: 'Reading must be a whole number of tenths between 1 and 9999' })
          continue
        }
      } else if (typeof raw === 'string') {
        const trimmed = raw.trim()
        if (trimmed === '' || trimmed === '0') normalized = null
        else if (/^\d+$/.test(trimmed)) {
          const value = Number(trimmed)
          if (value >= 1 && value <= MAX_TENTHS) normalized = value
          else {
            rejected.push({ date, value: raw, reason: 'Reading must be a whole number of tenths between 1 and 9999' })
            continue
          }
        } else {
          rejected.push({ date, value: raw, reason: 'Reading is not a whole number' })
          continue
        }
      } else {
        rejected.push({ date, value: raw, reason: 'Reading must be a number' })
        continue
      }
      if (incoming.has(date)) warnings.push(`Duplicate date ${date}; the last value wins`)
      incoming.set(date, normalized)
    }

    return this.exclusive(async () => {
      const current = await this.read()
      if (current.parseError && !options.force) throw new CorruptDataError(current.parseError)
      if (options.ifMatch && options.ifMatch !== current.etag) throw new ConflictError(current)

      let nextEntries: Record<string, unknown>
      if (options.replaceAll) {
        nextEntries = {}
        for (const [date, value] of incoming) {
          if (value !== null) nextEntries[date] = value
        }
      } else {
        nextEntries = { ...current.data.entries }
        for (const [date, value] of incoming) {
          if (value === null) delete nextEntries[date]
          else nextEntries[date] = value
        }
      }

      let added = 0
      let updated = 0
      let unchanged = 0
      let removed = 0
      const touched = options.replaceAll ? new Set(Object.keys(nextEntries)) : new Set(incoming.keys())
      for (const date of touched) {
        const beforeValue = tolerantTenths(current.data.entries[date])
        const before = beforeValue !== null && beforeValue > 0 ? beforeValue : null
        const rawAfter = nextEntries[date]
        const afterValue = tolerantTenths(rawAfter)
        const after = rawAfter === undefined || afterValue === null || afterValue <= 0 ? null : afterValue
        if (before === after) unchanged += 1
        else if (before === null) added += 1
        else if (after === null) removed += 1
        else updated += 1
      }
      if (options.replaceAll) {
        for (const key of Object.keys(current.data.entries)) {
          if (touched.has(key)) continue
          const beforeValue = tolerantTenths(current.data.entries[key])
          if (beforeValue !== null && beforeValue > 0) removed += 1
        }
      }

      const report: ImportReport = {
        dryRun: Boolean(options.dryRun),
        replaceAll: Boolean(options.replaceAll),
        added,
        updated,
        unchanged,
        removed,
        rejected,
        warnings,
        total: incoming.size,
      }
      if (options.dryRun) return report

      await this.maybeExternalSnapshot(current)
      const text = serializeData({ ...current.data, entries: nextEntries })
      await atomicWrite(this.dataPath, text)
      const written = await this.read()
      this.lastWrittenEtag = written.etag
      await this.maybeIntervalSnapshot(written, 'import')
      return { ...report, etag: written.etag }
    })
  }

  async snapshotNow(reason = 'manual', text?: string): Promise<SnapshotInfo> {
    return this.exclusive(async () => {
      const source = text ?? (await this.read()).text
      const info = await this.writeSnapshot(source, reason)
      this.lastSnapshotAt = Date.now()
      return info
    })
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const names = await fs.readdir(this.snapshotDir).catch(() => [] as string[])
    const out: SnapshotInfo[] = []
    for (const name of names) {
      if (!SNAPSHOT_RE.test(name)) continue
      try {
        const stat = await fs.stat(path.join(this.snapshotDir, name))
        const reason = name.replace(/^rainlog-\d{8}-\d{9}-/, '').replace(/\.json$/, '')
        out.push({ name, size: stat.size, mtimeMs: stat.mtimeMs, reason })
      } catch {
        // Ignore files that vanish mid-listing.
      }
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  }

  async readSnapshot(name: string): Promise<string> {
    const target = this.snapshotPath(name)
    try {
      return await fs.readFile(target, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError('Snapshot not found')
      throw error
    }
  }

  async restoreSnapshot(name: string): Promise<DataSnapshot> {
    const text = await this.readSnapshot(name)
    const parsed = parseData(text)
    if (parsed.parseError) throw new ValidationError(`Snapshot is not valid rain log data: ${parsed.parseError}`)
    return this.exclusive(async () => {
      const current = await this.read()
      if (current.exists && current.text !== '') await this.writeSnapshot(current.text, 'restore')
      const nextText = serializeData({ ...current.data, entries: parsed.data.entries })
      await atomicWrite(this.dataPath, nextText)
      const written = await this.read()
      this.lastWrittenEtag = written.etag
      return written
    })
  }

  private snapshotPath(name: string): string {
    if (!SNAPSHOT_RE.test(name)) throw new ValidationError('Invalid snapshot name')
    return path.join(this.snapshotDir, name)
  }

  private async writeSnapshot(text: string, reason: string): Promise<SnapshotInfo> {
    const safeReason = reason.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'manual'
    const name = `rainlog-${timestamp()}-${safeReason}.json`
    const target = path.join(this.snapshotDir, name)
    await atomicWrite(target, text, 0o600)
    await this.pruneSnapshots()
    const stat = await fs.stat(target)
    return { name, size: stat.size, mtimeMs: stat.mtimeMs, reason: safeReason }
  }

  private async pruneSnapshots(): Promise<void> {
    const snapshots = await this.listSnapshots()
    for (const snapshot of snapshots.slice(this.snapshotRetention)) {
      await fs.rm(this.snapshotPath(snapshot.name), { force: true }).catch(() => {})
    }
  }

  private async maybeExternalSnapshot(current: DataSnapshot): Promise<void> {
    if (!current.exists || this.lastWrittenEtag === null) return
    if (current.etag === this.lastWrittenEtag) return
    await this.writeSnapshot(current.text, 'external')
    this.lastSnapshotAt = Date.now()
  }

  private async maybeIntervalSnapshot(current: DataSnapshot, reason = 'interval'): Promise<void> {
    if (this.snapshotIntervalMs === 0) return
    if (Date.now() - this.lastSnapshotAt < this.snapshotIntervalMs) return
    await this.writeSnapshot(current.text, reason)
    this.lastSnapshotAt = Date.now()
  }
}
