import { tolerantTenths } from './storage.js'

export interface ParsedImport {
  entries: Record<string, unknown>
  warnings: string[]
}

export class ImportParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportParseError'
  }
}

export function detectFormat(content: string): 'json' | 'csv' {
  const trimmed = content.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json'
  return 'csv'
}

export function parseImport(content: string, format: 'auto' | 'json' | 'csv' = 'auto'): ParsedImport {
  const chosen = format === 'auto' ? detectFormat(content) : format
  return chosen === 'json' ? parseJsonImport(content) : parseCsvImport(content)
}

function parseJsonImport(content: string): ParsedImport {
  let parsed: unknown
  try {
    parsed = JSON.parse(content.replace(/^\uFEFF/, ''))
  } catch (error) {
    throw new ImportParseError(`Could not parse JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const warnings: string[] = []
  const entries: Record<string, unknown> = {}

  const add = (date: unknown, value: unknown) => {
    if (typeof date !== 'string' || date.trim() === '') {
      warnings.push(`Skipped a row without a usable date: ${JSON.stringify(value)}`)
      return
    }
    const key = date.trim()
    if (Object.prototype.hasOwnProperty.call(entries, key)) warnings.push(`Duplicate date ${key}; the last value wins`)
    entries[key] = value
  }

  if (Array.isArray(parsed)) {
    for (const row of parsed) {
      if (Array.isArray(row)) {
        add(row[0], row[1])
        continue
      }
      if (!row || typeof row !== 'object') {
        warnings.push(`Skipped a row that was not an object: ${JSON.stringify(row)}`)
        continue
      }
      const record = row as Record<string, unknown>
      const date = record.date ?? record.day ?? record.key
      let value = record.tenths ?? record.value ?? record.amount
      if (value === undefined && record.inches !== undefined) {
        value = inchesToTenths(record.inches)
      }
      add(date, value)
    }
    return { entries, warnings }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ImportParseError('JSON must be an object or an array of rows')
  }
  const record = parsed as Record<string, unknown>
  const inner = record.entries
  if (inner !== undefined) {
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) {
      throw new ImportParseError('"entries" must be an object of date → tenths')
    }
    for (const [date, value] of Object.entries(inner as Record<string, unknown>)) add(date, value)
    return { entries, warnings }
  }
  for (const [date, value] of Object.entries(record)) add(date, value)
  return { entries, warnings }
}

function inchesToTenths(value: unknown): unknown {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 10)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.round(parsed * 10)
  }
  return value
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let index = 0
  const clean = text.replace(/^\uFEFF/, '')
  while (index < clean.length) {
    const char = clean[index] ?? ''
    if (quoted) {
      if (char === '"') {
        if (clean[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        quoted = false
        index += 1
        continue
      }
      field += char
      index += 1
      continue
    }
    if (char === '"') {
      quoted = true
      index += 1
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      index += 1
      continue
    }
    if (char === '\r') {
      index += 1
      continue
    }
    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      index += 1
      continue
    }
    field += char
    index += 1
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function parseCsvImport(content: string): ParsedImport {
  const rows = parseCsvRows(content).filter((row) => row.some((cell) => cell.trim() !== ''))
  const warnings: string[] = []
  const entries: Record<string, unknown> = {}
  if (rows.length === 0) return { entries, warnings }

  const first = rows[0] ?? []
  const normalizedHeader = first.map((cell) => cell.trim().toLowerCase())
  const hasHeader = normalizedHeader.some((cell) => ['date', 'day', 'tenths', 'inches'].includes(cell))
  let dateIndex = 0
  let tenthsIndex = 1
  let inchesIndex = -1
  let start = 0

  if (hasHeader) {
    dateIndex = normalizedHeader.findIndex((cell) => cell === 'date' || cell === 'day')
    tenthsIndex = normalizedHeader.findIndex((cell) => cell === 'tenths' || cell === 'tenth')
    inchesIndex = normalizedHeader.findIndex((cell) => cell === 'inches' || cell === 'inch')
    start = 1
    if (dateIndex === -1) throw new ImportParseError('CSV header needs a "date" column')
    if (tenthsIndex === -1 && inchesIndex === -1) {
      throw new ImportParseError('CSV header needs a "tenths" or "inches" column')
    }
  }

  for (let i = start; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const date = (row[dateIndex] ?? '').trim()
    if (date === '') {
      warnings.push(`Line ${i + 1} has no date; skipped`)
      continue
    }
    let value: unknown
    if (tenthsIndex >= 0) {
      value = (row[tenthsIndex] ?? '').trim()
    } else {
      value = inchesToTenths((row[inchesIndex] ?? '').trim())
    }
    if (Object.prototype.hasOwnProperty.call(entries, date)) warnings.push(`Duplicate date ${date}; the last value wins`)
    entries[date] = value
  }
  return { entries, warnings }
}

export function toCsv(entries: Record<string, number>): string {
  const lines = ['date,tenths,inches']
  for (const date of Object.keys(entries).sort()) {
    const tenths = tolerantTenths(entries[date]) ?? 0
    lines.push(`${date},${tenths},${(tenths / 10).toFixed(1)}`)
  }
  return `${lines.join('\n')}\n`
}

export function toJson(entries: Record<string, number>): string {
  const sorted: Record<string, number> = {}
  for (const date of Object.keys(entries).sort()) sorted[date] = entries[date] as number
  return `${JSON.stringify({ entries: sorted }, null, 2)}\n`
}
