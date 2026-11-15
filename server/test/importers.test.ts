import { describe, expect, it } from 'vitest'
import { ImportParseError, parseImport, toCsv, toJson } from '../src/importers.js'

describe('parseImport', () => {
  it('reads the plugin JSON shape', () => {
    const parsed = parseImport('{"entries":{"2026-01-01":23,"2026-01-02":"4"}}')
    expect(parsed.entries).toEqual({ '2026-01-01': 23, '2026-01-02': '4' })
  })

  it('reads a plain date map and an array of rows', () => {
    expect(parseImport('{"2026-01-01":5}').entries).toEqual({ '2026-01-01': 5 })
    expect(
      parseImport('[{"date":"2026-01-01","tenths":5},{"date":"2026-01-02","inches":0.7}]').entries,
    ).toEqual({ '2026-01-01': 5, '2026-01-02': 7 })
    expect(parseImport('[["2026-01-01",5]]').entries).toEqual({ '2026-01-01': 5 })
  })

  it('reads CSV with and without a header', () => {
    expect(parseImport('date,tenths\n2026-01-01,12\n2026-01-02,7').entries).toEqual({
      '2026-01-01': '12',
      '2026-01-02': '7',
    })
    expect(parseImport('2026-01-01,12\r\n2026-01-02,7\r\n').entries).toEqual({
      '2026-01-01': '12',
      '2026-01-02': '7',
    })
  })

  it('converts an inches column to tenths', () => {
    expect(parseImport('date,inches\n2026-01-01,0.4\n2026-01-02,1.25').entries).toEqual({
      '2026-01-01': 4,
      '2026-01-02': 13,
    })
  })

  it('handles quoted fields with commas', () => {
    expect(parseImport('date,tenths\n"2026-01-01","12"\n').entries).toEqual({ '2026-01-01': '12' })
  })

  it('warns about duplicate dates', () => {
    const parsed = parseImport('date,tenths\n2026-01-01,1\n2026-01-01,2')
    expect(parsed.entries).toEqual({ '2026-01-01': '2' })
    expect(parsed.warnings[0]).toMatch(/Duplicate date/)
  })

  it('rejects unusable input', () => {
    expect(() => parseImport('{ broken', 'json')).toThrow(ImportParseError)
    expect(() => parseImport('not,a,date', 'json')).toThrow(ImportParseError)
    expect(() => parseImport('date\n2026-01-01', 'csv')).toThrow(ImportParseError)
  })
})

describe('export', () => {
  it('round-trips CSV', () => {
    const text = toCsv({ '2026-01-02': 7, '2026-01-01': 12 })
    expect(text).toBe('date,tenths,inches\n2026-01-01,12,1.2\n2026-01-02,7,0.7\n')
    expect(parseImport(text).entries).toEqual({ '2026-01-01': '12', '2026-01-02': '7' })
  })

  it('exports plugin-compatible JSON', () => {
    const text = toJson({ '2026-01-02': 7, '2026-01-01': 12 })
    expect(JSON.parse(text)).toEqual({ entries: { '2026-01-01': 12, '2026-01-02': 7 } })
    expect(Object.keys(JSON.parse(text).entries)).toEqual(['2026-01-01', '2026-01-02'])
  })
})
