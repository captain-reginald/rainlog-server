export type Entries = Record<string, number>

export interface Window {
  start: Date
  end: Date
}

export interface NamedWindow extends Window {
  name: string
}

function pad(n: number): string {
  return (n < 10 ? '0' : '') + n
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseDateKey(key: string): Date | null {
  const parts = String(key).split('-')
  if (parts.length !== 3) return null
  const y = Number.parseInt(parts[0] ?? '', 10)
  const m = Number.parseInt(parts[1] ?? '', 10) - 1
  const d = Number.parseInt(parts[2] ?? '', 10)
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return null
  return new Date(y, m, d, 12)
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime())
  r.setDate(r.getDate() + n)
  return r
}

export function noonToday(): Date {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  return d
}

export function seasonStart(d: Date): Date {
  let y = d.getFullYear()
  const m = d.getMonth()
  if (m >= 11 || m <= 1) {
    if (m <= 1) y -= 1
    return new Date(y, 11, 1, 12)
  }
  if (m >= 2 && m <= 4) return new Date(y, 2, 1, 12)
  if (m >= 5 && m <= 7) return new Date(y, 5, 1, 12)
  return new Date(y, 8, 1, 12)
}

export function seasonName(d: Date): string {
  const m = d.getMonth()
  if (m >= 11 || m <= 1) return 'Winter'
  if (m >= 2 && m <= 4) return 'Spring'
  if (m >= 5 && m <= 7) return 'Summer'
  return 'Autumn'
}

export function sumEntries(entries: Entries, startDate: Date, endDate: Date): number {
  let total = 0
  const cursor = new Date(startDate.getTime())
  cursor.setHours(12, 0, 0, 0)
  const end = new Date(endDate.getTime())
  end.setHours(12, 0, 0, 0)
  while (cursor.getTime() <= end.getTime()) {
    const value = entries[dateKey(cursor)]
    if (value !== undefined && value !== null) {
      const parsed = Number.parseInt(String(value), 10)
      if (!Number.isNaN(parsed)) total += parsed
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return total
}

export function dayWindow(n: number, offset: number): Window {
  const today = noonToday()
  const end = addDays(today, -offset * n)
  const start = addDays(end, -(n - 1))
  return { start, end }
}

export function sumWindowDays(entries: Entries, n: number, offset: number): number {
  const { start, end } = dayWindow(n, offset)
  return sumEntries(entries, start, end)
}

export function monthWindow(offset: number): Window {
  const ref = new Date()
  ref.setDate(1)
  ref.setMonth(ref.getMonth() - offset)
  return {
    start: new Date(ref.getFullYear(), ref.getMonth(), 1, 12),
    end: new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 12),
  }
}

export function seasonWindow(offset: number): NamedWindow {
  const ref = new Date()
  ref.setMonth(ref.getMonth() - offset * 3)
  const start = seasonStart(ref)
  const end = new Date(start.getTime())
  end.setMonth(end.getMonth() + 3)
  end.setDate(end.getDate() - 1)
  end.setHours(12, 0, 0, 0)
  return { start, end, name: seasonName(start) }
}

export function recentDays(n: number): string[] {
  const out: string[] = []
  const today = noonToday()
  for (let i = n - 1; i >= 0; i -= 1) out.push(dateKey(addDays(today, -i)))
  return out
}

export function lastNDays(entries: Entries, n: number): { key: string; value: number }[] {
  return recentDays(n).map((key) => ({ key, value: entries[key] ?? 0 }))
}

export function recentRainy(entries: Entries, limit = 5): { key: string; value: number }[] {
  return Object.keys(entries)
    .filter((key) => (entries[key] ?? 0) > 0)
    .sort()
    .reverse()
    .slice(0, limit)
    .map((key) => ({ key, value: entries[key] as number }))
}

export function monthlyTotals(entries: Entries, year: number): number[] {
  const totals = Array.from({ length: 12 }, () => 0)
  for (const [key, value] of Object.entries(entries)) {
    if (!key.startsWith(`${year}-`)) continue
    const month = Number.parseInt(key.slice(5, 7), 10) - 1
    if (month >= 0 && month < 12) totals[month] = (totals[month] ?? 0) + value
  }
  return totals
}

export function yearTotal(entries: Entries, year: number): number {
  return monthlyTotals(entries, year).reduce((sum, value) => sum + value, 0)
}

export function yearsWithData(entries: Entries): number[] {
  const years = new Set<number>()
  for (const key of Object.keys(entries)) {
    const year = Number.parseInt(key.slice(0, 4), 10)
    if (Number.isFinite(year)) years.add(year)
  }
  years.add(new Date().getFullYear())
  return [...years].sort((a, b) => b - a)
}

export function cumulativeSeason(entries: Entries, reference: Date): { key: string; value: number }[] {
  const start = seasonStart(reference)
  const end = new Date(start.getTime())
  end.setMonth(end.getMonth() + 3)
  end.setDate(end.getDate() - 1)
  const today = noonToday()
  const last = today.getTime() < end.getTime() ? today : end
  const out: { key: string; value: number }[] = []
  let running = 0
  const cursor = new Date(start.getTime())
  while (cursor.getTime() <= last.getTime()) {
    const key = dateKey(cursor)
    running += entries[key] ?? 0
    out.push({ key, value: running })
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

export function seasonForYear(entries: Entries, year: number, season: string): { key: string; value: number }[] {
  const starts: Record<string, number> = { Spring: 2, Summer: 5, Autumn: 8, Winter: 11 }
  const month = starts[season] ?? 11
  const start = new Date(year, month, 1, 12)
  return cumulativeSeason(entries, start)
}
