import { useMemo, useState } from 'react'
import { MonthlyChart, SeasonCompareChart } from '../components/charts'
import { formatAmount, formatMonthShort, formatShortDate, formatValue } from '../lib/format'
import { useRainlogState } from '../lib/hooks'
import { monthlyTotals, yearsWithData, yearTotal } from '../lib/model'

export function Charts() {
  const stateQuery = useRainlogState()
  const state = stateQuery.data
  const entries = useMemo(() => state?.entries ?? {}, [state])
  const units = state?.prefs.units ?? 'in'
  const [chosenYear, setChosenYear] = useState<number | null>(null)
  const years = useMemo(() => yearsWithData(entries), [entries])
  const year = chosenYear ?? new Date().getFullYear()

  const totals = useMemo(() => monthlyTotals(entries, year), [entries, year])
  const total = yearTotal(entries, year)
  const rainyDays = useMemo(
    () => Object.entries(entries).filter(([key, value]) => key.startsWith(`${year}-`) && value > 0).length,
    [entries, year],
  )
  const wettestMonthIndex = totals.reduce((best, value, index) => (value > (totals[best] ?? 0) ? index : best), 0)
  const wettestMonth = totals[wettestMonthIndex] ?? 0
  const wettestDay = useMemo(() => {
    let best: { key: string; value: number } | null = null
    for (const [key, value] of Object.entries(entries)) {
      if (!key.startsWith(`${year}-`)) continue
      if (!best || value > best.value) best = { key, value }
    }
    return best
  }, [entries, year])
  const yearly = useMemo(
    () => yearsWithData(entries).map((item) => ({ year: item, total: yearTotal(entries, item) })),
    [entries],
  )
  const maxYear = Math.max(...yearly.map((item) => item.total), 1)

  if (stateQuery.isLoading) return <div className="loading">Loading charts…</div>
  if (stateQuery.isError) {
    return (
      <div className="card error-card">
        <h2>Can’t load charts</h2>
        <p>{stateQuery.error instanceof Error ? stateQuery.error.message : 'The server did not respond.'}</p>
        <button type="button" className="primary" onClick={() => void stateQuery.refetch()}>
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Charts</p>
          <h1>Rainfall patterns</h1>
        </div>
        <label className="year-picker">
          <span>Year</span>
          <select value={year} onChange={(event) => setChosenYear(Number(event.target.value))}>
            {years.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="stats-grid stats-grid-tight">
        <article className="stat-card">
          <span className="stat-label">Year total</span>
          <div className="stat-value">
            {formatValue(total, units)}
            <span className="stat-unit">{units}</span>
          </div>
          <div className="stat-range">January–December {year}</div>
        </article>
        <article className="stat-card">
          <span className="stat-label">Rainy days</span>
          <div className="stat-value">
            {rainyDays}
            <span className="stat-unit">days</span>
          </div>
          <div className="stat-range">Days with a reading in {year}</div>
        </article>
        <article className="stat-card">
          <span className="stat-label">Wettest month</span>
          <div className="stat-value">
            {formatValue(wettestMonth, units)}
            <span className="stat-unit">{units}</span>
          </div>
          <div className="stat-range">
            {wettestMonth > 0 ? `${formatMonthShort(wettestMonthIndex)} ${year}` : `No rain recorded in ${year}`}
          </div>
        </article>
        <article className="stat-card">
          <span className="stat-label">Wettest day</span>
          <div className="stat-value">
            {formatValue(wettestDay?.value ?? 0, units)}
            <span className="stat-unit">{units}</span>
          </div>
          <div className="stat-range">
            {wettestDay ? formatShortDate(wettestDay.key) : `No rain recorded in ${year}`}
          </div>
        </article>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Monthly totals — {year}</h2>
          <span className="muted">{formatAmount(total, units)} this year</span>
        </div>
        <MonthlyChart entries={entries} year={year} units={units} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Season to date</h2>
          <span className="muted">Compared with the previous season</span>
        </div>
        <SeasonCompareChart entries={entries} units={units} />
        <p className="card-note">
          Seasons are meteorological: December–February, March–May, June–August, September–November.
          The previous line stops at the same day of its season.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Every year on record</h2>
          <span className="muted">{yearly.length} year{yearly.length === 1 ? '' : 's'}</span>
        </div>
        <ul className="year-list">
          {yearly.map((item) => (
            <li key={item.year}>
              <button type="button" className="year-row" onClick={() => setChosenYear(item.year)}>
                <span className="year-name">{item.year}</span>
                <span className="year-bar-track">
                  <span className="year-bar" style={{ width: `${(item.total / maxYear) * 100}%` }} />
                </span>
                <strong>{formatAmount(item.total, units)}</strong>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
