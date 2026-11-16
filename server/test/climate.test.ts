import { describe, expect, it } from 'vitest'
import { monthlyAveragesMm, resolvedPlaceName } from '../src/climate.js'

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

function makeDays(years: number[], mmFor: (year: number, month: number) => number) {
  const time: string[] = []
  const values: (number | null)[] = []
  for (const year of years) {
    for (let month = 0; month < 12; month += 1) {
      for (let day = 1; day <= daysIn(year, month); day += 1) {
        const pad = (value: number) => String(value).padStart(2, '0')
        time.push(`${year}-${pad(month + 1)}-${pad(day)}`)
        values.push(mmFor(year, month))
      }
    }
  }
  return { time, values }
}

describe('monthlyAveragesMm', () => {
  it('averages each calendar month across complete years', () => {
    const { time, values } = makeDays([2019, 2020], (year, month) =>
      month === 0 ? 25.4 / daysIn(year, month) : 0,
    )
    const { monthlyMm, yearsUsed } = monthlyAveragesMm(time, values)
    expect(yearsUsed).toBe(2)
    expect(monthlyMm[0]).toBeCloseTo(25.4, 5)
    expect(monthlyMm[1]).toBe(0)
  })

  it('skips a partial month-year instead of biasing it low', () => {
    const { time, values } = makeDays([2019, 2020], () => 1)
    const cut = time.findIndex((day) => day === '2020-03-15')
    time.splice(cut, 10)
    values.splice(cut, 10)
    const { monthlyMm, yearsUsed } = monthlyAveragesMm(time, values)
    const march = monthlyMm[2] ?? 0
    // 2019 March is complete (31 mm); 2020 March is missing days and is ignored.
    // 2020 still contributes its other complete months.
    expect(march).toBeCloseTo(31, 5)
    expect(yearsUsed).toBe(2)
  })

  it('skips a month that has a null reading', () => {
    const { time, values } = makeDays([2019], () => 2)
    values[0] = null
    const { monthlyMm } = monthlyAveragesMm(time, values)
    expect(monthlyMm[0]).toBe(0)
  })

  it('returns zeroes when there is no usable data', () => {
    const result = monthlyAveragesMm([], [])
    expect(result.monthlyMm).toEqual(Array.from({ length: 12 }, () => 0))
    expect(result.yearsUsed).toBe(0)
  })
})

describe('resolvedPlaceName', () => {
  it('joins only the parts that exist', () => {
    expect(
      resolvedPlaceName({ name: 'Denver', admin1: 'Colorado', country: 'United States', latitude: 0, longitude: 0 }),
    ).toBe('Denver, Colorado, United States')
    expect(resolvedPlaceName({ name: 'Lyon', latitude: 0, longitude: 0 })).toBe('Lyon')
  })
})
