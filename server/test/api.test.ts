import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import type { StatePayload } from '../src/storage.js'

let dir: string
let app: FastifyInstance

const originHeaders = { host: 'rain.local:8080', origin: 'http://rain.local:8080' }

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rainlog-api-'))
  const built = await buildApp({
    dataDir: dir,
    logger: false,
    snapshotIntervalSec: 0,
    snapshotRetention: 5,
  })
  app = built.app
})

afterEach(async () => {
  await app.close()
  await fs.rm(dir, { recursive: true, force: true })
})

async function getState(): Promise<StatePayload> {
  const response = await app.inject({ method: 'GET', url: '/api/state' })
  expect(response.statusCode).toBe(200)
  return response.json() as StatePayload
}

async function putEntry(
  date: string,
  tenths: number | null,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: 'PUT',
    url: `/api/entries/${date}`,
    headers: { ...originHeaders, 'content-type': 'application/json', ...headers },
    payload: JSON.stringify({ tenths, ...extra }),
  })
}

describe('API', () => {
  it('reports health', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ ok: true, dataWritable: true })
  })

  it('returns empty state on a fresh volume', async () => {
    const state = await getState()
    expect(state.entries).toEqual({})
    expect(state.parseError).toBeNull()
    expect(state.prefs).toEqual({ version: 1, units: 'in', windows: [30] })
    expect(state.conflicts).toEqual([])
  })

  it('writes and removes entries in the plugin file format', async () => {
    const written = await putEntry('2026-11-14', 23)
    expect(written.statusCode).toBe(200)
    const state = written.json() as StatePayload
    expect(state.entries).toEqual({ '2026-11-14': 23 })

    const text = await fs.readFile(path.join(dir, 'rainlog.json'), 'utf8')
    expect(JSON.parse(text)).toEqual({ entries: { '2026-11-14': 23 } })
    expect(text).toBe('{\n  "entries": {\n    "2026-11-14": 23\n  }\n}')

    const removed = await putEntry('2026-11-14', null)
    expect((removed.json() as StatePayload).entries).toEqual({})
  })

  it('rejects invalid dates and readings', async () => {
    expect((await putEntry('2026-02-30', 5)).statusCode).toBe(400)
    expect((await putEntry('2026-11-14', 0)).statusCode).toBe(400)
    expect((await putEntry('2026-11-14', 2.5)).statusCode).toBe(400)
  })

  it('returns 409 with current state on a conflicting write', async () => {
    await putEntry('2026-01-01', 5)
    const before = await getState()
    await fs.writeFile(
      path.join(dir, 'rainlog.json'),
      JSON.stringify({ entries: { '2026-01-01': 9 } }, null, 2),
    )
    const response = await putEntry(
      '2026-01-01',
      7,
      { expectedPrevious: 5 },
      { 'if-match': before.etag },
    )
    expect(response.statusCode).toBe(409)
    const body = response.json() as { error: string; state: StatePayload }
    expect(body.error).toBe('conflict')
    expect(body.state.entries['2026-01-01']).toBe(9)
  })

  it('merges a stale write when the target day did not change', async () => {
    await putEntry('2026-01-01', 5)
    const before = await getState()
    await fs.writeFile(
      path.join(dir, 'rainlog.json'),
      JSON.stringify({ entries: { '2026-01-01': 5, '2026-01-02': 4 } }, null, 2),
    )
    const response = await putEntry(
      '2026-01-01',
      8,
      { expectedPrevious: 5 },
      { 'if-match': before.etag },
    )
    expect(response.statusCode).toBe(200)
    expect((response.json() as StatePayload).entries).toEqual({
      '2026-01-01': 8,
      '2026-01-02': 4,
    })
  })

  it('blocks cross-origin and non-JSON writes', async () => {
    const crossOrigin = await putEntry('2026-01-01', 1, {}, { origin: 'http://evil.example' })
    expect(crossOrigin.statusCode).toBe(403)

    const textPlain = await app.inject({
      method: 'PUT',
      url: '/api/entries/2026-01-01',
      headers: { ...originHeaders, 'content-type': 'text/plain' },
      payload: '{"tenths":1}',
    })
    expect(textPlain.statusCode).toBe(415)
  })

  it('supports dry-run and applied imports', async () => {
    await putEntry('2026-01-01', 4)
    const dry = await app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { ...originHeaders, 'content-type': 'application/json' },
      payload: JSON.stringify({
        content: 'date,tenths\n2026-01-01,4\n2026-01-02,6',
        dryRun: true,
      }),
    })
    expect(dry.statusCode).toBe(200)
    expect(dry.json().report).toMatchObject({ added: 1, unchanged: 1 })
    expect((await getState()).entries).toEqual({ '2026-01-01': 4 })

    const applied = await app.inject({
      method: 'POST',
      url: '/api/import',
      headers: { ...originHeaders, 'content-type': 'application/json' },
      payload: JSON.stringify({
        content: JSON.stringify({ entries: { '2026-01-01': 5, '2026-01-03': 2 } }),
        format: 'json',
      }),
    })
    expect(applied.statusCode).toBe(200)
    expect(applied.json().report).toMatchObject({ added: 1, updated: 1 })
    // The dry run did not persist its 2026-01-02 reading.
    expect((await getState()).entries).toEqual({
      '2026-01-01': 5,
      '2026-01-03': 2,
    })
  })

  it('exports CSV and JSON', async () => {
    await putEntry('2026-01-02', 7)
    await putEntry('2026-01-01', 12)

    const csv = await app.inject({ method: 'GET', url: '/api/export.csv' })
    expect(csv.statusCode).toBe(200)
    expect(csv.headers['content-type']).toContain('text/csv')
    expect(csv.body).toBe('date,tenths,inches\n2026-01-01,12,1.2\n2026-01-02,7,0.7\n')

    const json = await app.inject({ method: 'GET', url: '/api/export.json' })
    expect(json.statusCode).toBe(200)
    expect(JSON.parse(json.body)).toEqual({ entries: { '2026-01-01': 12, '2026-01-02': 7 } })
  })

  it('stores preferences in the sidecar file', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/preferences',
      headers: { ...originHeaders, 'content-type': 'application/json' },
      payload: JSON.stringify({ units: 'mm', windows: [21, 45] }),
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ version: 1, units: 'mm', windows: [21, 45] })

    const sidecar = JSON.parse(
      await fs.readFile(path.join(dir, 'rainlog-web.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(sidecar).toEqual({ version: 1, units: 'mm', windows: [21, 45] })
    expect((await getState()).prefs.units).toBe('mm')
  })

  it('migrates a single legacy custom window', async () => {
    await fs.writeFile(
      path.join(dir, 'rainlog-web.json'),
      JSON.stringify({ version: 1, units: 'in', customDays: 10 }),
    )
    expect((await getState()).prefs).toEqual({ version: 1, units: 'in', windows: [10] })
  })

  it('rejects an empty or oversized window list', async () => {
    for (const windows of [[], [1, 2, 3, 4], [0], [400]]) {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/preferences',
        headers: { ...originHeaders, 'content-type': 'application/json' },
        payload: JSON.stringify({ units: 'in', windows }),
      })
      expect(response.statusCode).toBe(400)
    }
  })

  it('resolves and caches climate normals, then clears them', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith('https://geocoding-api.open-meteo.com/')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                name: 'Denver',
                admin1: 'Colorado',
                country: 'United States',
                latitude: 39.7392,
                longitude: -104.9903,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      const time: string[] = []
      const precipitation: number[] = []
      for (let year = 1991; year <= 2020; year += 1) {
        for (let month = 0; month < 12; month += 1) {
          const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
          for (let day = 1; day <= days; day += 1) {
            const pad = (value: number) => String(value).padStart(2, '0')
            time.push(`${year}-${pad(month + 1)}-${pad(day)}`)
            precipitation.push(month === 0 && day === 1 ? 25.4 : 0)
          }
        }
      }
      return new Response(
        JSON.stringify({ daily: { time, precipitation_sum: precipitation } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const saved = await app.inject({
        method: 'PUT',
        url: '/api/climate',
        headers: { ...originHeaders, 'content-type': 'application/json' },
        payload: JSON.stringify({ locality: 'Denver' }),
      })
      expect(saved.statusCode).toBe(200)
      const climate = saved.json().climate as {
        resolvedName: string
        monthlyTenths: number[]
        periodStart: number
      }
      expect(climate.resolvedName).toBe('Denver, Colorado, United States')
      expect(climate.periodStart).toBe(1991)
      expect(climate.monthlyTenths).toHaveLength(12)
      expect(climate.monthlyTenths[0]).toBe(10)

      const listed = await app.inject({ method: 'GET', url: '/api/climate' })
      expect(listed.json().climate.resolvedName).toBe('Denver, Colorado, United States')

      const cleared = await app.inject({
        method: 'DELETE',
        url: '/api/climate',
        headers: { ...originHeaders, 'content-type': 'application/json' },
        payload: '{}',
      })
      expect(cleared.statusCode).toBe(200)
      expect((await app.inject({ method: 'GET', url: '/api/climate' })).json().climate).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports an unknown locality', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 })),
    )
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/climate',
        headers: { ...originHeaders, 'content-type': 'application/json' },
        payload: JSON.stringify({ locality: 'Nowhere At All' }),
      })
      expect(response.statusCode).toBe(404)
      expect(response.json().error).toBe('location_not_found')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('creates, downloads, and restores snapshots', async () => {
    await putEntry('2026-01-01', 4)
    const created = await app.inject({
      method: 'POST',
      url: '/api/snapshots',
      headers: { ...originHeaders, 'content-type': 'application/json' },
      payload: '{}',
    })
    expect(created.statusCode).toBe(201)
    const name = created.json().snapshot.name as string
    expect(name).toMatch(/^rainlog-\d{8}-\d{9}-manual\.json$/)

    await putEntry('2026-01-01', 9)

    const download = await app.inject({ method: 'GET', url: `/api/snapshots/${name}` })
    expect(download.statusCode).toBe(200)
    expect(JSON.parse(download.body)).toEqual({ entries: { '2026-01-01': 4 } })

    const restored = await app.inject({
      method: 'POST',
      url: `/api/snapshots/${name}/restore`,
      headers: { ...originHeaders, 'content-type': 'application/json' },
      payload: '{}',
    })
    expect(restored.statusCode).toBe(200)
    expect((restored.json() as StatePayload).entries).toEqual({ '2026-01-01': 4 })
  })

  it('detects syncing conflict files without touching them', async () => {
    const conflictName = 'rainlog.sync-conflict-20261114-120000-ABCDEFG.json'
    await fs.writeFile(path.join(dir, conflictName), '{"entries":{}}')
    const state = await getState()
    expect(state.conflicts.map((file) => file.name)).toEqual([conflictName])
    expect(await fs.readFile(path.join(dir, conflictName), 'utf8')).toBe('{"entries":{}}')
  })

  it('reports corrupt data instead of overwriting it', async () => {
    await fs.writeFile(path.join(dir, 'rainlog.json'), '{ nope')
    const state = await getState()
    expect(state.parseError).toBeTruthy()

    const response = await putEntry('2026-01-01', 2)
    expect(response.statusCode).toBe(422)
    expect((await fs.readFile(path.join(dir, 'rainlog.json'), 'utf8')).trim()).toBe('{ nope')
  })

  it('returns JSON 404s for unknown API routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(response.statusCode).toBe(404)
    expect(response.json().error).toBe('not_found')
  })
})
