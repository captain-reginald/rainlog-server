import { useMemo, useState, type FormEvent } from 'react'
import { useToast } from '../components/Toast'
import {
  formatAmount,
  formatLongDate,
  formatMonthYear,
  formatValue,
  parseTenthsInput,
} from '../lib/format'
import { useEntryDraft, useRainlogState, useSetEntry } from '../lib/hooks'
import { dateKey, parseDateKey, sumEntries } from '../lib/model'

function calendarGrid(year: number, month: number): (string | null)[] {
  const firstWeekday = new Date(year, month, 1, 12).getDay()
  const days = new Date(year, month + 1, 0, 12).getDate()
  const cells: (string | null)[] = Array.from({ length: firstWeekday }, () => null)
  for (let day = 1; day <= days; day += 1) cells.push(dateKey(new Date(year, month, day, 12)))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

const WEEKDAYS = Array.from({ length: 7 }, (_, index) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(2026, 0, 4 + index, 12)),
)

export function History() {
  const stateQuery = useRainlogState()
  const state = stateQuery.data
  const entries = useMemo(() => state?.entries ?? {}, [state])
  const units = state?.prefs.units ?? 'in'
  const today = dateKey(new Date())
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const [selectedDate, setSelectedDate] = useState(today)
  const setEntry = useSetEntry()
  const { notify } = useToast()
  const currentValue = entries[selectedDate]
  const { draft, setDraft, inputRef } = useEntryDraft(selectedDate, currentValue)
  const [saving, setSaving] = useState(false)

  const cells = useMemo(() => calendarGrid(cursor.year, cursor.month), [cursor])
  const monthStats = useMemo(() => {
    const start = new Date(cursor.year, cursor.month, 1, 12)
    const end = new Date(cursor.year, cursor.month + 1, 0, 12)
    const total = sumEntries(entries, start, end)
    const rainyDays = Object.keys(entries).filter(
      (key) => key.startsWith(`${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`) && (entries[key] ?? 0) > 0,
    ).length
    return { total, rainyDays }
  }, [entries, cursor])

  const parsed = parseTenthsInput(draft)
  const preview =
    parsed.kind === 'value'
      ? `${formatAmount(parsed.tenths, 'in')} · ${formatAmount(parsed.tenths, 'mm')}`
      : parsed.kind === 'clear'
        ? 'Saves as no rain for this day'
        : draft.trim() === ''
          ? ''
          : 'Enter a whole number of tenths, e.g. 23 for 2.3 in'

  const moveMonth = (delta: number) => {
    const next = new Date(cursor.year, cursor.month + delta, 1, 12)
    setCursor({ year: next.getFullYear(), month: next.getMonth() })
    setSelectedDate(dateKey(next))
  }

  const jumpToToday = () => {
    const now = new Date()
    setCursor({ year: now.getFullYear(), month: now.getMonth() })
    setSelectedDate(today)
  }

  const save = async (tenths: number | null) => {
    setSaving(true)
    try {
      await setEntry.mutateAsync({
        date: selectedDate,
        tenths,
        etag: state?.etag,
        expectedPrevious: currentValue ?? null,
      })
      notify(tenths === null ? `Cleared ${formatLongDate(selectedDate)}.` : `Saved ${formatLongDate(selectedDate)}.`, 'success')
    } catch {
      // Reported by the mutation toast.
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

  if (stateQuery.isLoading) return <div className="loading">Loading calendar…</div>
  if (stateQuery.isError) {
    return (
      <div className="card error-card">
        <h2>Can’t load the calendar</h2>
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
          <p className="eyebrow">History</p>
          <h1>Calendar</h1>
        </div>
        <p className="muted page-head-note">
          One reading per day. Clear a field to remove that day.
        </p>
      </div>

      <div className="history-layout">
        <section className="card calendar-card">
          <div className="calendar-head">
            <button type="button" className="icon-button" onClick={() => moveMonth(-1)} aria-label="Previous month">
              ‹
            </button>
            <h2>{formatMonthYear(new Date(cursor.year, cursor.month, 1, 12))}</h2>
            <button type="button" className="icon-button" onClick={() => moveMonth(1)} aria-label="Next month">
              ›
            </button>
            <button type="button" className="ghost small" onClick={jumpToToday}>
              Today
            </button>
          </div>

          <div className="calendar-grid" role="grid" aria-label="Rainfall calendar">
            {WEEKDAYS.map((label) => (
              <div className="weekday" key={label} role="columnheader">
                {label}
              </div>
            ))}
            {cells.map((key, index) => {
              if (!key) return <div key={`blank-${index}`} className="calendar-blank" />
              const value = entries[key]
              const classes = ['calendar-cell']
              if (value) classes.push('has-rain')
              if (key === today) classes.push('is-today')
              if (key === selectedDate) classes.push('is-selected')
              const dayNumber = parseDateKey(key)?.getDate() ?? ''
              return (
                <button
                  type="button"
                  key={key}
                  className={classes.join(' ')}
                  onClick={() => setSelectedDate(key)}
                  aria-label={`${formatLongDate(key)}: ${value ? formatAmount(value, units) : 'no reading'}`}
                  aria-pressed={key === selectedDate}
                >
                  <span className="day-number">{dayNumber}</span>
                  <span className="day-amount">{value ? formatValue(value, units) : '–'}</span>
                </button>
              )
            })}
          </div>

          <div className="calendar-summary">
            <span>
              Month total <strong>{formatAmount(monthStats.total, units)}</strong>
            </span>
            <span>
              Rainy days <strong>{monthStats.rainyDays}</strong>
            </span>
            <span className="muted">Values shown in {units}</span>
          </div>
        </section>

        <section className="card editor-card">
          <p className="eyebrow">{currentValue ? 'Editing a reading' : 'Recording a reading'}</p>
          <h2>{formatLongDate(selectedDate)}</h2>
          <p className="muted">
            {currentValue
              ? `Currently ${formatAmount(currentValue, units)}.`
              : 'No rain recorded for this day.'}
          </p>
          <form onSubmit={submit} className="editor-form">
            <label htmlFor="history-reading">Reading in tenths of an inch</label>
            <div className="entry-row">
              <input
                id="history-reading"
                ref={inputRef}
                className="entry-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                placeholder={currentValue ? String(currentValue) : '0'}
              />
              <span className="input-suffix">tenths</span>
            </div>
            <p className={parsed.kind === 'invalid' ? 'hint hint-error' : 'hint'}>{preview || '\u00a0'}</p>
            <div className="button-row">
              <button type="submit" className="primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save reading'}
              </button>
              {currentValue !== undefined ? (
                <button
                  type="button"
                  className="ghost"
                  disabled={saving}
                  onClick={() => {
                    setDraft('')
                    void save(null)
                  }}
                >
                  Clear day
                </button>
              ) : null}
            </div>
          </form>
          <div className="divider" />
          <p className="card-note">
            Tenths match the markings on a US rain gauge: 23 means 2.3 inches. Readings are stored as
            whole tenths, so the numbers stay exact.
          </p>
        </section>
      </div>
    </div>
  )
}
