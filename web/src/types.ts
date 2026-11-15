export type Units = 'in' | 'mm'

export interface Preferences {
  version: 1
  units: Units
  customDays: number
}

export interface ConflictFile {
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
  conflicts: ConflictFile[]
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

export interface SnapshotInfo {
  name: string
  size: number
  mtimeMs: number
  reason: string
}
