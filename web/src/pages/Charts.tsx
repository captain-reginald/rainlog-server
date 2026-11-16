import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchClimate } from '../api'
import { ClimateMonthlyChart, MonthlyChart } from '../components/charts'
import {
  formatAmount,
  formatMonthShort,
  formatMonthYear,
  formatShortDate,
  formatValue,
} from '../lib/format'
import { useRainlogState } from '../lib/hooks'
import {
  monthlyTotals,
  noonToday,
  normalBetween,
  normalMonth,
  normalSeason,
  normalYear,
  seasonWindow,
  sumEntries,
  yearsWithData,
  yearTotal,
} from '../lib/model'
import type { Units } from '../types'

interface CompareNumbers {
  actual: number
  toDate: number
  full: number
}

function CompareCard({
  label,
  period,
  numbers,
  units,
}: {
  label: string
  period: string
  numbers: CompareNumbers
  units: Units
}) {
  const max = Math.max(numbers.actual, numbers.toDate, 1)
  const percent = numbers.toDate > 0 ? Math.round((numbers.actual / numbers.toDate) * 100) : null
  const tone = percent === null ? '' : percent >= 100 ? 'is-above' : percent >= 75 ? 'is-near' : 'is-below'
  return (
    <article className="compare-card">
      <div className="compare-head">
        <span className="stat-label">{label}</span>
        <span className={`compare-pct ${tone}`}>{percent === null ? '—' : `${percent}%`}</span>
      </div>
      <div className="compare-value">
        {formatValue(numbers.actual, units)}
        <span className="stat-unit">{units}</span>
      </div>
      <div className="compare-caption">
        of {formatValue(numbers.toDate, units)} {units} average to date
      </div>
      <div className="compare-bars">
        <div className="compare-bar-row">
          <span className="compare-bar-label">Yours</span>
          <span className="compare-track">
            <span className="compare-fill own" style={{ width: `${(numbers.actual / max) * 100}%` }} />
          </span>
        </div>
        <div className="compare-bar-row">
          <span className="compare-bar-label">Average</span>
          <span className="compare-track">
            <span className="compare-fill average" style={{ width: `${(numbers.toDate / max) * 100}%` }} />
          </span>
        </div>
      </div>
      <div className="compare-foot">
        Full {period} average: {formatValue(numbers.full, units)} {units}
      </div>
    </article>
  )
}

export function Charts() {
  const stateQuery = useRainlogState()
  const climateQuery = useQuery({ queryKey: ['climate'], queryFn: fetchClimate, staleTime: 60_000 })
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

  const climate = climateQuery.data?.climate ?? null
  const comparison = useMemo(() => {
    if (!climate) return null
    const monthly = climate.monthlyTenths
    const today = noonToday()
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1, 12)
    const currentSeason = seasonWindow(0)
    const yearStart = new Date(today.getFullYear(), 0, 1, 12)
    return {
      month: {
        actual: sumEntries(entries, monthStart, today),
        toDate: normalBetween(monthly, monthStart, today),
        full: normalMonth(monthly, today.getMonth()),
      },
      season: {
        actual: sumEntries(entries, currentSeason.start, today),
        toDate: normalBetween(monthly, currentSeason.start, today),
        full: normalSeason(monthly, today),
      },
      year: {
        actual: sumEntries(entries, yearStart, today),
        toDate: normalBetween(monthly, yearStart, today),
        full: normalYear(monthly),
      },
      seasonName: currentSeason.name,
      seasonYear: currentSeason.start.getFullYear(),
    }
  }, [climate, entries])

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

  const now = new Date()

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
          <h2>Compared with your area</h2>
          {climate ? (
            <span className="muted">
              {climate.resolvedName} · {climate.periodStart}–{climate.periodEnd} normals
            </span>
          ) : null}
        </div>

        {!climate ? (
          <div className="empty-compare">
            <p className="muted">
              Add your locality in Settings to compare rain to date with your area’s monthly,
              seasonal, and yearly averages.
            </p>
            <Link to="/settings" className="button primary">
              Open Settings
            </Link>
          </div>
        ) : comparison ? (
          <>
            {year === now.getFullYear() ? (
              <div className="compare-grid">
                <CompareCard
                  label={formatMonthYear(new Date(now.getFullYear(), now.getMonth(), 1, 12))}
                  period="month"
                  numbers={comparison.month}
                  units={units}
                />
                <CompareCard
                  label={`${comparison.seasonName} ${comparison.seasonYear}`}
                  period="season"
                  numbers={comparison.season}
                  units={units}
                />
                <CompareCard
                  label={String(now.getFullYear())}
                  period="year"
                  numbers={comparison.year}
                  units={units}
                />
              </div>
            ) : (
              <p className="muted">
                Rain-to-date cards follow the current year ({now.getFullYear()}). The chart below still
                compares {year} with the same monthly averages.
              </p>
            )}

            <div className="climate-chart">
              <div className="card-head">
                <h3>Month by month — {year}</h3>
                <div className="chart-legend">
                  <span className="legend-item">
                    <span className="legend-swatch swatch-actual" />
                    Recorded
                  </span>
                  <span className="legend-item">
                    <span className="legend-swatch swatch-average" />
                    {climate.periodStart}–{climate.periodEnd} average
                  </span>
                </div>
              </div>
              <ClimateMonthlyChart
                entries={entries}
                year={year}
                units={units}
                monthlyTenths={climate.monthlyTenths}
                ariaLabel={`Recorded and average monthly rainfall for ${year}`}
              />
            </div>

            <p className="card-note">
              The average line spreads each month’s normal evenly across its days, so “to date”
              follows the calendar. Normals come from Open-Meteo and are cached on this server.
            </p>
          </>
        ) : null}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Every year on record</h2>
          <span className="muted">
            {yearly.length} year{yearly.length === 1 ? '' : 's'}
          </span>
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
