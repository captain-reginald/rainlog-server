import type { ClimateCache } from './storage.js'

/**
 * Climate normals come from Open-Meteo's free geocoding and historical
 * archive APIs. Only the locality string is sent; the result is cached in
 * rainlog-climate.json so the comparison keeps working offline afterwards.
 */

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'
export const NORMALS_START_YEAR = 1991
export const NORMALS_END_YEAR = 2020
const FETCH_TIMEOUT_MS = 25_000

export class ClimateNotFoundError extends Error {
  constructor(locality: string) {
    super(`No location found for “${locality}”`)
    this.name = 'ClimateNotFoundError'
  }
}

export class ClimateUpstreamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClimateUpstreamError'
  }
}

export interface Place {
  name: string
  admin1?: string | undefined
  country?: string | undefined
  latitude: number
  longitude: number
}

interface GeocodeResponse {
  results?: Array<{
    name?: unknown
    admin1?: unknown
    country?: unknown
    latitude?: unknown
    longitude?: unknown
  }>
}

interface ArchiveResponse {
  daily?: {
    time?: unknown
    precipitation_sum?: unknown
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

async function fetchJson(url: URL): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'rainlog-server/1.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    throw new ClimateUpstreamError(
      'Could not reach the climate service. Check the server’s internet access and try again.',
    )
  }
  if (!response.ok) {
    throw new ClimateUpstreamError(`The climate service returned HTTP ${response.status}.`)
  }
  try {
    return await response.json()
  } catch {
    throw new ClimateUpstreamError('The climate service returned an unexpected response.')
  }
}

export async function geocode(locality: string): Promise<Place> {
  const url = new URL(GEOCODING_URL)
  url.searchParams.set('name', locality)
  url.searchParams.set('count', '1')
  url.searchParams.set('language', 'en')
  url.searchParams.set('format', 'json')
  const body = (await fetchJson(url)) as GeocodeResponse
  const first = body.results?.[0]
  if (!first || typeof first.name !== 'string' || !isFiniteNumber(first.latitude) || !isFiniteNumber(first.longitude)) {
    throw new ClimateNotFoundError(locality)
  }
  return {
    name: first.name,
    admin1: typeof first.admin1 === 'string' ? first.admin1 : undefined,
    country: typeof first.country === 'string' ? first.country : undefined,
    latitude: first.latitude,
    longitude: first.longitude,
  }
}

export function resolvedPlaceName(place: Place): string {
  return [place.name, place.admin1, place.country].filter((part): part is string => Boolean(part)).join(', ')
}

interface MonthAccumulator {
  sum: number
  days: number
  expected: number
}

/**
 * Average millimetres per calendar month over complete month-years.
 * Partial months (missing days) are skipped so a gap cannot bias the normal.
 */
export function monthlyAveragesMm(
  times: string[],
  values: (number | null)[],
): { monthlyMm: number[]; yearsUsed: number } {
  const groups: Map<number, MonthAccumulator>[] = Array.from({ length: 12 }, () => new Map())
  for (let index = 0; index < times.length; index += 1) {
    const time = times[index]
    const value = values[index]
    if (typeof time !== 'string' || !isFiniteNumber(value)) continue
    const year = Number.parseInt(time.slice(0, 4), 10)
    const month = Number.parseInt(time.slice(5, 7), 10) - 1
    if (!Number.isInteger(year) || month < 0 || month > 11) continue
    const expected = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    const group = groups[month]!
    const current = group.get(year) ?? { sum: 0, days: 0, expected }
    current.sum += value
    current.days += 1
    group.set(year, current)
  }

  const years = new Set<number>()
  const monthlyMm = groups.map((group) => {
    const complete: number[] = []
    for (const [year, accumulator] of group) {
      if (accumulator.days !== accumulator.expected) continue
      complete.push(accumulator.sum)
      years.add(year)
    }
    if (complete.length === 0) return 0
    return complete.reduce((sum, value) => sum + value, 0) / complete.length
  })
  return { monthlyMm, yearsUsed: years.size }
}

function mmToTenths(mm: number): number {
  return Math.max(0, Math.round(mm / 2.54))
}

async function fetchMonthlyNormals(place: Place): Promise<number[]> {
  const url = new URL(ARCHIVE_URL)
  url.searchParams.set('latitude', place.latitude.toFixed(4))
  url.searchParams.set('longitude', place.longitude.toFixed(4))
  url.searchParams.set('start_date', `${NORMALS_START_YEAR}-01-01`)
  url.searchParams.set('end_date', `${NORMALS_END_YEAR}-12-31`)
  url.searchParams.set('daily', 'precipitation_sum')
  url.searchParams.set('timezone', 'UTC')
  const body = (await fetchJson(url)) as ArchiveResponse
  const times = body.daily?.time
  const values = body.daily?.precipitation_sum
  if (!Array.isArray(times) || !Array.isArray(values)) {
    throw new ClimateUpstreamError('The climate service returned no daily rainfall data.')
  }
  const numericValues = values.map((value) => (isFiniteNumber(value) ? value : null))
  const { monthlyMm } = monthlyAveragesMm(times as string[], numericValues)
  return monthlyMm.map(mmToTenths)
}

export async function resolveClimate(locality: string): Promise<ClimateCache> {
  const trimmed = locality.trim()
  if (trimmed.length < 2) throw new ClimateNotFoundError(trimmed)
  const place = await geocode(trimmed)
  const monthlyTenths = await fetchMonthlyNormals(place)
  return {
    version: 1,
    locality: trimmed,
    resolvedName: resolvedPlaceName(place),
    latitude: place.latitude,
    longitude: place.longitude,
    periodStart: NORMALS_START_YEAR,
    periodEnd: NORMALS_END_YEAR,
    monthlyTenths,
    fetchedAt: new Date().toISOString(),
  }
}
