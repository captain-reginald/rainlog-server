import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import {
  ApiError,
  clearLocality,
  fetchClimate,
  fetchHealth,
  saveLocality,
} from '../api'
import { useToast } from '../components/Toast'
import { formatDateTime } from '../lib/format'
import { apiErrorMessage, useRainlogState, useSavePreferences } from '../lib/hooks'
import type { Units } from '../types'

const MAX_WINDOWS = 3

export function Settings() {
  const stateQuery = useRainlogState()
  const state = stateQuery.data
  const healthQuery = useQuery({ queryKey: ['health'], queryFn: fetchHealth, staleTime: 30_000 })
  const climateQuery = useQuery({ queryKey: ['climate'], queryFn: fetchClimate, staleTime: 60_000 })
  const savePreferences = useSavePreferences()
  const queryClient = useQueryClient()
  const { notify } = useToast()

  const [units, setUnits] = useState<Units>('in')
  const [windows, setWindows] = useState<string[]>(['30'])
  const [locality, setLocality] = useState('')
  const [initialized, setInitialized] = useState(false)
  const [climateInitialized, setClimateInitialized] = useState(false)

  useEffect(() => {
    if (state && !initialized) {
      setUnits(state.prefs.units)
      setWindows(state.prefs.windows.map(String))
      setInitialized(true)
    }
  }, [state, initialized])

  const climate = climateQuery.data?.climate ?? null
  useEffect(() => {
    if (climate && !climateInitialized) {
      setLocality(climate.locality)
      setClimateInitialized(true)
    }
  }, [climate, climateInitialized])

  const localityMutation = useMutation({
    mutationFn: (value: string) => saveLocality(value),
    onSuccess: (data) => {
      queryClient.setQueryData(['climate'], data)
      notify(`Averages loaded for ${data.climate.resolvedName}.`, 'success')
    },
    onError: (error) => notify(apiErrorMessage(error), 'error'),
  })

  const clearMutation = useMutation({
    mutationFn: clearLocality,
    onSuccess: () => {
      queryClient.setQueryData(['climate'], { climate: null })
      setLocality('')
      setClimateInitialized(true)
      notify('Locality averages removed.', 'success')
    },
    onError: (error) => notify(apiErrorMessage(error), 'error'),
  })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = windows.map((value) => Number.parseInt(value, 10))
    if (parsed.length < 1 || parsed.length > MAX_WINDOWS) {
      notify(`Keep between 1 and ${MAX_WINDOWS} windows.`, 'error')
      return
    }
    if (parsed.some((days) => !Number.isInteger(days) || days < 1 || days > 365)) {
      notify('Each window must be between 1 and 365 days.', 'error')
      return
    }
    try {
      await savePreferences.mutateAsync({ units, windows: parsed })
      notify('Settings saved.', 'success')
    } catch {
      // Reported by the mutation toast.
    }
  }

  const submitLocality = (event: FormEvent) => {
    event.preventDefault()
    const value = locality.trim()
    if (value.length < 2) {
      notify('Enter a city or region to look up.', 'error')
      return
    }
    localityMutation.mutate(value)
  }

  if (stateQuery.isLoading) return <div className="loading">Loading settings…</div>
  if (stateQuery.isError) {
    return (
      <div className="card error-card">
        <h2>Can’t load settings</h2>
        <p>{stateQuery.error instanceof Error ? stateQuery.error.message : 'The server did not respond.'}</p>
        <button type="button" className="primary" onClick={() => void stateQuery.refetch()}>
          Try again
        </button>
      </div>
    )
  }

  const health = healthQuery.data
  const busy = localityMutation.isPending || clearMutation.isPending

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Display, averages, and server</h1>
        </div>
        <p className="muted page-head-note">Units, dashboard windows, and your local climate normals.</p>
      </div>

      <div className="settings-grid">
        <section className="card">
          <div className="card-head">
            <h2>Display</h2>
          </div>
          <form className="form-stack" onSubmit={submit}>
            <label className="field">
              <span>Units</span>
              <select value={units} onChange={(event) => setUnits(event.target.value as Units)}>
                <option value="in">Inches (in)</option>
                <option value="mm">Millimetres (mm)</option>
              </select>
            </label>
            <p className="card-note">
              Readings are entered and stored in tenths of an inch. Millimetres are a display
              conversion only.
            </p>

            <div className="field">
              <span>Dashboard windows</span>
              <div className="window-editor">
                {windows.map((value, index) => (
                  <div className="window-row" key={`window-${index}`}>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={value}
                      aria-label={`Window ${index + 1} length in days`}
                      onChange={(event) =>
                        setWindows((current) =>
                          current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)),
                        )
                      }
                    />
                    <span className="window-unit">days</span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove window ${index + 1}`}
                      disabled={windows.length === 1}
                      onClick={() => setWindows((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="ghost small"
                  disabled={windows.length >= MAX_WINDOWS}
                  onClick={() => setWindows((current) => [...current, '30'])}
                >
                  Add window
                </button>
              </div>
            </div>
            <p className="card-note">
              Each window becomes its own total on the dashboard, from 1 to 365 days. Up to three
              windows.
            </p>

            <div className="button-row">
              <button type="submit" className="primary" disabled={savePreferences.isPending}>
                {savePreferences.isPending ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </form>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Server</h2>
            <span className={health?.dataWritable ? 'status-ok' : 'status-bad'}>
              {health ? (health.dataWritable ? 'Storage writable' : 'Storage not writable') : 'Checking…'}
            </span>
          </div>
          <ul className="info-list">
            <li>
              <span>Version</span>
              <strong>{health?.version ?? '—'}</strong>
            </li>
            <li>
              <span>Refresh interval</span>
              <strong>5 seconds</strong>
            </li>
            <li>
              <span>Units</span>
              <strong>{units === 'in' ? 'Inches' : 'Millimetres'}</strong>
            </li>
          </ul>
          <p className="card-note">
            The web app keeps polling while the tab is open, so totals follow edits made anywhere.
          </p>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Local rainfall averages</h2>
          {climate ? (
            <span className="status-ok">
              {climate.resolvedName} · {climate.periodStart}–{climate.periodEnd}
            </span>
          ) : null}
        </div>
        <p className="muted">
          Enter the city or region whose rainfall averages you want to compare against. The locality
          is sent to Open-Meteo, which returns historical monthly normals; the result is cached on
          this server so the comparison keeps working offline.
        </p>
        <form className="locality-form" onSubmit={submitLocality}>
          <label className="field">
            <span>Locality</span>
            <input
              type="text"
              value={locality}
              onChange={(event) => setLocality(event.target.value)}
              placeholder="e.g. Denver, Colorado"
              autoComplete="off"
            />
          </label>
          <div className="button-row">
            <button type="submit" className="primary" disabled={busy}>
              {localityMutation.isPending
                ? 'Looking up…'
                : climate
                  ? 'Refresh averages'
                  : 'Save and look up'}
            </button>
            {climate ? (
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => clearMutation.mutate()}
              >
                Remove
              </button>
            ) : null}
          </div>
        </form>
        {climate ? (
          <p className="card-note">
            Covers {climate.periodStart}–{climate.periodEnd} at {climate.latitude.toFixed(2)},{' '}
            {climate.longitude.toFixed(2)}. Last fetched {formatDateTime(Date.parse(climate.fetchedAt))}.
          </p>
        ) : null}
        {climateQuery.isError ? (
          <p className="hint hint-error">
            {climateQuery.error instanceof ApiError
              ? climateQuery.error.message
              : 'Could not load the saved averages.'}
          </p>
        ) : null}
      </section>

      <p className="compat-line">Cross Compatible with the Omarchy Rainlog Plugin via backend sync</p>

      <p className="disclaimer-line">
        This service has not been vetted for public web-facing use. Use internally or at your own
        risk.
      </p>
    </div>
  )
}
