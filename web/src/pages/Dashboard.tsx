import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { TrendChart } from '../components/charts'
import { StatCard } from '../components/StatCard'
import { useToast } from '../components/Toast'
import {
  formatAmount,
  formatLongDate,
  formatMonthYear,
  formatRange,
  formatValue,
  formatWindowLabel,
  parseTenthsInput,
} from '../lib/format'
import { useEntryDraft, useRainlogState, useSetEntry } from '../lib/hooks'
import {
  dateKey,
  dayWindow,
  monthWindow,
  recentRainy,
  seasonWindow,
  sumEntries,
} from '../lib/model'

interface Offsets {
  d1: number
  d3: number
  week: number
  custom: number
  month: number
  season: number
}

const INITIAL_OFFSETS: Offsets = { d1: 0, d3: 0, week: 0, custom: 0, month: 0, season: 0 }

export function Dashboard() {
  const stateQuery = useRainlogState()
  const state = stateQuery.data
  const entries = useMemo(() => state?.entries ?? {}, [state])
  const units = state?.prefs.units ?? 'in'
  const customDays = state?.prefs.customDays ?? 14
  const today = dateKey(new Date())
  const currentToday = entries[today]
  const { draft, setDraft, inputRef } = useEntryDraft(today, currentToday)
  const setEntry = useSetEntry()
  const { notify } = useToast()
  const [saving, setSaving] = useState(false)
  const [offsets, setOffsets] = useState<Offsets>(INITIAL_OFFSETS)

  const parsed = parseTenthsInput(draft)
  const preview =
    parsed.kind === 'value'
      ? `${formatAmount(parsed.tenths, 'in')} · ${formatAmount(parsed.tenths, 'mm')}`
      : parsed.kind === 'clear'
        ? 'Saves as no rain for today'
        : draft.trim() === ''
          ? ''
          : 'Enter a whole number of tenths, e.g. 23 for 2.3 in'

  const views = useMemo(() => {
    const w1 = dayWindow(1, offsets.d1)
    const w3 = dayWindow(3, offsets.d3)
    const week = dayWindow(7, offsets.week)
    const custom = dayWindow(customDays, offsets.custom)
    return {
      d1: { window: w1, total: sumEntries(entries, w1.start, w1.end) },
      d3: { window: w3, total: sumEntries(entries, w3.start, w3.end) },
      week: { window: week, total: sumEntries(entries, week.start, week.end) },
      custom: { window: custom, total: sumEntries(entries, custom.start, custom.end) },
      month: { window: monthWindow(offsets.month) },
      season: { window: seasonWindow(offsets.season) },
    }
  }, [entries, offsets, customDays])

  const monthTotal = sumEntries(entries, views.month.window.start, views.month.window.end)
  const seasonTotal = sumEntries(entries, views.season.window.start, views.season.window.end)
  const rainy = recentRainy(entries, 5)

  const bump = (key: keyof Offsets, delta: number) => {
    setOffsets((current) => ({ ...current, [key]: Math.max(0, current[key] + delta) }))
  }

  const save = async (tenths: number | null) => {
    setSaving(true)
    try {
      await setEntry.mutateAsync({
        date: today,
        tenths,
        etag: state?.etag,
        expectedPrevious: currentToday ?? null,
      })
      notify(tenths === null ? 'Cleared today’s reading.' : 'Saved today’s reading.', 'success')
    } catch {
      // The mutation reports the failure through a toast.
    } finally {
      setSaving(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (parsed.kind === 'invalid') {
      notify('Enter a whole number of tenths, like 23 for 2.3 in.', 'error')
      return
    }
    void save(parsed.kind === 'clear' ? null : parsed.tenths)
  }

  if (stateQuery.isLoading) {
    return <div className="loading">Loading readings…</div>
  }

  if (stateQuery.isError) {
    return (
      <div className="card error-card">
        <h2>Can’t reach the rain log</h2>
        <p>{stateQuery.error instanceof Error ? stateQuery.error.message : 'The server did not respond.'}</p>
        <button type="button" className="primary" onClick={() => void stateQuery.refetch()}>
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="page">
      <section className="today-panel">
        <div className="today-copy">
          <p className="eyebrow">Today</p>
          <h1>{formatLongDate(today)}</h1>
          <p className="muted">
            Gauge reading in tenths of an inch. Turn <strong>23</strong> into 2.3 inches.
          </p>
        </div>
        <form className="today-form" onSubmit={submit}>
          <div className="entry-row">
            <label className="sr-only" htmlFor="today-reading">
              Today’s rainfall in tenths of an inch
            </label>
            <input
              id="today-reading"
              ref={inputRef}
              className="entry-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              placeholder={currentToday ? String(currentToday) : '0'}
            />
            <span className="input-suffix">tenths</span>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {currentToday !== undefined ? (
              <button
                type="button"
                className="ghost"
                disabled={saving}
                onClick={() => {
                  setDraft('')
                  void save(null)
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
          <p className={parsed.kind === 'invalid' ? 'hint hint-error' : 'hint'}>{preview || '\u00a0'}</p>
        </form>
      </section>

      <section className="stats-grid" aria-label="Rolling totals">
        <StatCard
          label="24 hours"
          tenths={views.d1.total}
          units={units}
          rangeLabel={formatWindowLabel(views.d1.window.start, views.d1.window.end, true)}
          onPrev={() => bump('d1', 1)}
          onNext={offsets.d1 > 0 ? () => bump('d1', -1) : undefined}
        />
        <StatCard
          label="72 hours"
          tenths={views.d3.total}
          units={units}
          rangeLabel={formatWindowLabel(views.d3.window.start, views.d3.window.end, false)}
          onPrev={() => bump('d3', 1)}
          onNext={offsets.d3 > 0 ? () => bump('d3', -1) : undefined}
        />
        <StatCard
          label="7 days"
          tenths={views.week.total}
          units={units}
          rangeLabel={formatWindowLabel(views.week.window.start, views.week.window.end, false)}
          onPrev={() => bump('week', 1)}
          onNext={offsets.week > 0 ? () => bump('week', -1) : undefined}
        />
        <StatCard
          label={`${customDays} days`}
          tenths={views.custom.total}
          units={units}
          rangeLabel={formatWindowLabel(views.custom.window.start, views.custom.window.end, false)}
          onPrev={() => bump('custom', 1)}
          onNext={offsets.custom > 0 ? () => bump('custom', -1) : undefined}
        />
        <StatCard
          label="Month"
          tenths={monthTotal}
          units={units}
          rangeLabel={formatMonthYear(views.month.window.start)}
          onPrev={() => bump('month', 1)}
          onNext={offsets.month > 0 ? () => bump('month', -1) : undefined}
        />
        <StatCard
          label="Season"
          tenths={seasonTotal}
          units={units}
          rangeLabel={`${views.season.window.name} ${views.season.window.start.getFullYear()}`}
          onPrev={() => bump('season', 1)}
          onNext={offsets.season > 0 ? () => bump('season', -1) : undefined}
        />
      </section>

      <section className="split-grid">
        <article className="card">
          <div className="card-head">
            <h2>Recent rainy days</h2>
            <Link to="/history" className="text-link">
              Calendar
            </Link>
          </div>
          {rainy.length > 0 ? (
            <ul className="rainy-list">
              {rainy.map((day) => (
                <li key={day.key}>
                  <span>{formatLongDate(day.key)}</span>
                  <strong>{formatAmount(day.value, units)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No rain recorded yet. Add today’s reading to start the log.</p>
          )}
          <p className="card-note">
            Season window: {formatRange(views.season.window.start, views.season.window.end)}
          </p>
        </article>

        <article className="card">
          <div className="card-head">
            <h2>Last 30 days</h2>
            <Link to="/charts" className="text-link">
              Charts
            </Link>
          </div>
          <TrendChart entries={entries} units={units} />
          <p className="card-note">
            Today is {formatValue(currentToday ?? 0, units)} {units}. Totals update automatically when
            the file changes on disk.
          </p>
        </article>
      </section>
    </div>
  )
}
