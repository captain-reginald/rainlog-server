import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ConflictError,
  CorruptDataError,
  RainlogStore,
  serializeData,
} from '../src/storage.js'

let dir: string
let store: RainlogStore

async function readJson(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(dir, 'rainlog.json'), 'utf8')) as Record<string, unknown>
}

async function externalWrite(entries: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<void> {
  await fs.writeFile(path.join(dir, 'rainlog.json'), JSON.stringify({ entries, ...extra }, null, 2))
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rainlog-store-'))
  store = new RainlogStore({ dataDir: dir, snapshotIntervalSec: 0, snapshotRetention: 5 })
  await store.init()
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('RainlogStore', () => {
  it('creates a plugin-compatible empty file on init', async () => {
    const text = await fs.readFile(path.join(dir, 'rainlog.json'), 'utf8')
    expect(text).toBe(serializeData({ entries: {} }))
    expect(JSON.parse(text)).toEqual({ entries: {} })
  })

  it('writes integer tenths in the plugin format with sorted keys', async () => {
    await store.setEntry('2026-11-14', 2)
    await store.setEntry('2026-03-01', 15)
    const text = await fs.readFile(path.join(dir, 'rainlog.json'), 'utf8')
    expect(text).toBe(
      JSON.stringify({ entries: { '2026-03-01': 15, '2026-11-14': 2 } }, null, 2),
    )
    expect(text.endsWith('\n')).toBe(false)
  })

  it('removes a day when the reading is cleared', async () => {
    await store.setEntry('2026-11-14', 2)
    await store.setEntry('2026-11-14', null)
    expect(await readJson()).toEqual({ entries: {} })
  })

  it('rejects impossible dates and non-integer readings', async () => {
    await expect(store.setEntry('2026-02-30', 1)).rejects.toThrow(/Invalid date/)
    await expect(store.setEntry('2026-11-14', 1.5)).rejects.toThrow(/whole number/)
    await expect(store.setEntry('2026-11-14', 10_000)).rejects.toThrow(/whole number/)
  })

  it('reads legacy numeric strings like the plugin does', async () => {
    await externalWrite({ '2026-01-01': '23', '2026-01-02': 4, 'not-a-date': 9 })
    const state = await store.state()
    expect(state.entries).toEqual({ '2026-01-01': 23, '2026-01-02': 4 })
  })

  it('preserves unknown top-level keys and untouched entries on write', async () => {
    await externalWrite({ '2026-01-01': 5, '2026-01-02': '7' }, { meta: { source: 'test' } })
    await store.setEntry('2026-01-03', 6)
    const data = await readJson()
    expect(data.entries).toEqual({ '2026-01-01': 5, '2026-01-02': '7', '2026-01-03': 6 })
    expect(data.meta).toEqual({ source: 'test' })
  })

  it('auto-merges a stale write when the target day is unchanged', async () => {
    await store.setEntry('2026-01-01', 5)
    const before = await store.read()
    await externalWrite({ '2026-01-01': 5, '2026-01-02': 3 })

    const after = await store.setEntry('2026-01-01', 7, {
      ifMatch: before.etag,
      expectedPrevious: 5,
    })
    expect(after.entries).toEqual({ '2026-01-01': 7, '2026-01-02': 3 })
    const snapshots = await store.listSnapshots()
    expect(snapshots.some((snapshot) => snapshot.reason === 'external')).toBe(true)
  })

  it('refuses a stale write when the target day also changed', async () => {
    await store.setEntry('2026-01-01', 5)
    const before = await store.read()
    await externalWrite({ '2026-01-01': 9 })
    await expect(
      store.setEntry('2026-01-01', 7, { ifMatch: before.etag, expectedPrevious: 5 }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('refuses writes to a corrupt file and reports the parse error', async () => {
    await fs.writeFile(path.join(dir, 'rainlog.json'), '{ not json')
    const state = await store.state()
    expect(state.parseError).toBeTruthy()
    await expect(store.setEntry('2026-01-01', 1)).rejects.toBeInstanceOf(CorruptDataError)
  })

  it('supports a forced replace-all import after corruption', async () => {
    await fs.writeFile(path.join(dir, 'rainlog.json'), '{ not json')
    const report = await store.importEntries({ '2026-01-01': 4 }, { replaceAll: true, force: true })
    expect(report.added).toBe(1)
    expect(await readJson()).toEqual({ entries: { '2026-01-01': 4 } })
  })

  it('reports import changes without writing during a dry run', async () => {
    await store.setEntry('2026-01-01', 4)
    const report = await store.importEntries(
      { '2026-01-01': 4, '2026-01-02': 6, '2026-02-30': 2, '2026-01-03': 0 },
      { dryRun: true },
    )
    expect(report).toMatchObject({ dryRun: true, added: 1, unchanged: 2 })
    expect(report.rejected.some((row) => row.date === '2026-02-30')).toBe(true)
    expect(await readJson()).toEqual({ entries: { '2026-01-01': 4 } })
  })

  it('merges imports per day and can replace everything', async () => {
    await store.setEntry('2026-01-01', 4)
    await store.setEntry('2026-01-02', 8)
    const merged = await store.importEntries({ '2026-01-02': 9, '2026-01-03': 1 })
    expect(merged).toMatchObject({ updated: 1, added: 1, removed: 0 })
    expect(await readJson()).toEqual({
      entries: { '2026-01-01': 4, '2026-01-02': 9, '2026-01-03': 1 },
    })

    const replaced = await store.importEntries({ '2026-05-05': 2 }, { replaceAll: true })
    expect(replaced.removed).toBe(3)
    expect(await readJson()).toEqual({ entries: { '2026-05-05': 2 } })
  })

  it('restores a manual snapshot', async () => {
    await store.setEntry('2026-01-01', 4)
    const snapshot = await store.snapshotNow('manual')
    await store.setEntry('2026-01-01', 9)
    await store.restoreSnapshot(snapshot.name)
    expect((await store.read()).entries).toEqual({ '2026-01-01': 4 })
  })

  it('prunes snapshots beyond the retention limit', async () => {
    for (let i = 0; i < 8; i += 1) await store.snapshotNow('manual')
    expect((await store.listSnapshots()).length).toBeLessThanOrEqual(5)
  })

  it('rejects path traversal in snapshot names', async () => {
    await expect(store.readSnapshot('../rainlog.json')).rejects.toThrow(/Invalid snapshot name/)
  })

  it('changes the etag when the file changes', async () => {
    const first = await store.read()
    await store.setEntry('2026-01-01', 1)
    const second = await store.read()
    expect(first.etag).not.toBe(second.etag)
  })
})
