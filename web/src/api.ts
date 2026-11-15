import type { ImportReport, Preferences, SnapshotInfo, StatePayload } from './types'

export interface ApiErrorBody {
  error?: string
  message?: string
  state?: StatePayload
  report?: ImportReport
  parseError?: string
  details?: unknown
}

export class ApiError extends Error {
  readonly status: number
  readonly body: ApiErrorBody

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || `Request failed with status ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers })
  if (!response.ok) {
    let body: ApiErrorBody = {}
    try {
      body = (await response.json()) as ApiErrorBody
    } catch {
      body = { message: response.statusText }
    }
    throw new ApiError(response.status, body)
  }
  return (await response.json()) as T
}

export interface HealthPayload {
  ok: boolean
  version: string
  dataWritable: boolean
}

export function fetchState(): Promise<StatePayload> {
  return request<StatePayload>('/api/state')
}

export function fetchHealth(): Promise<HealthPayload> {
  return request<HealthPayload>('/api/health')
}

export interface SetEntryOptions {
  etag?: string
  expectedPrevious?: number | null
}

export function saveEntry(date: string, tenths: number | null, options: SetEntryOptions = {}): Promise<StatePayload> {
  const headers: Record<string, string> = {}
  if (options.etag) headers['If-Match'] = options.etag
  const payload: Record<string, unknown> = { tenths }
  if (options.expectedPrevious !== undefined) payload.expectedPrevious = options.expectedPrevious
  return request<StatePayload>(`/api/entries/${date}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  })
}

export function savePreferences(prefs: Pick<Preferences, 'units' | 'customDays'>): Promise<Preferences> {
  return request<Preferences>('/api/preferences', {
    method: 'PUT',
    body: JSON.stringify(prefs),
  })
}

export interface ImportRequest {
  content: string
  format: 'auto' | 'json' | 'csv'
  dryRun: boolean
  replaceAll: boolean
  ifMatch?: string
  force?: boolean
}

export interface ImportResponse {
  report: ImportReport
  state?: StatePayload
}

export function importData(payload: ImportRequest): Promise<ImportResponse> {
  return request<ImportResponse>('/api/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function listSnapshots(): Promise<{ snapshots: SnapshotInfo[] }> {
  return request<{ snapshots: SnapshotInfo[] }>('/api/snapshots')
}

export function createSnapshot(): Promise<{ snapshot: SnapshotInfo; snapshots: SnapshotInfo[] }> {
  return request<{ snapshot: SnapshotInfo; snapshots: SnapshotInfo[] }>('/api/snapshots', {
    method: 'POST',
    body: '{}',
  })
}

export function restoreSnapshot(name: string): Promise<StatePayload> {
  return request<StatePayload>(`/api/snapshots/${encodeURIComponent(name)}/restore`, {
    method: 'POST',
    body: '{}',
  })
}

export function snapshotDownloadUrl(name: string): string {
  return `/api/snapshots/${encodeURIComponent(name)}`
}
