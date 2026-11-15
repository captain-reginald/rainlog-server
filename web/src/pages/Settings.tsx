import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { fetchHealth } from '../api'
import { useToast } from '../components/Toast'
import { useRainlogState, useSavePreferences } from '../lib/hooks'
import type { Units } from '../types'

export function Settings() {
  const stateQuery = useRainlogState()
  const state = stateQuery.data
  const healthQuery = useQuery({ queryKey: ['health'], queryFn: fetchHealth, staleTime: 30_000 })
  const savePreferences = useSavePreferences()
  const { notify } = useToast()
  const [units, setUnits] = useState<Units>('in')
  const [customDays, setCustomDays] = useState('14')
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    if (state && !initialized) {
      setUnits(state.prefs.units)
      setCustomDays(String(state.prefs.customDays))
      setInitialized(true)
    }
  }, [state, initialized])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const days = Number.parseInt(customDays, 10)
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      notify('The custom window must be between 1 and 365 days.', 'error')
      return
    }
    try {
      await savePreferences.mutateAsync({ units, customDays: days })
      notify('Settings saved.', 'success')
    } catch {
      // Reported by the mutation toast.
    }
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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Display and server</h1>
        </div>
        <p className="muted page-head-note">
          These preferences live in <code>rainlog-web.json</code>, not the shared data file.
        </p>
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
              Readings are always entered and stored in tenths of an inch, matching the gauge and the
              plugin. Millimetres are a display conversion only, so nothing is rounded on disk.
            </p>
            <label className="field">
              <span>Custom window (days)</span>
              <input
                type="number"
                min={1}
                max={365}
                value={customDays}
                onChange={(event) => setCustomDays(event.target.value)}
              />
            </label>
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
              {health ? (health.dataWritable ? 'Data volume writable' : 'Data volume not writable') : 'Checking…'}
            </span>
          </div>
          <ul className="info-list">
            <li>
              <span>Version</span>
              <strong>{health?.version ?? '—'}</strong>
            </li>
            <li>
              <span>Shared data</span>
              <code>rainlog.json</code>
            </li>
            <li>
              <span>Web preferences</span>
              <code>rainlog-web.json</code>
            </li>
            <li>
              <span>Snapshots</span>
              <code>.rainlog-backups/</code>
            </li>
            <li>
              <span>Data directory</span>
              <code>/data</code>
            </li>
            <li>
              <span>File watcher</span>
              <strong>5 second refresh</strong>
            </li>
          </ul>
          <p className="card-note">
            The container reads the file fresh for every request and merges on write. It does not
            keep a database.
          </p>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Network and access</h2>
          <span className="status-bad">No built-in authentication</span>
        </div>
        <p className="muted">
          This server is meant for a trusted LAN or a private overlay network. The compose file
          publishes port <code>8080</code> on all interfaces so phones and other devices can reach
          it at <code>http://host-ip:8080</code>. If you ever expose it beyond your LAN, put it
          behind a reverse proxy with authentication (Caddy, Traefik, nginx) or reach it over
          Tailscale/WireGuard instead.
        </p>
        <p className="card-note">
          Mutating requests still require same-origin JSON and are rate limited, so a random web
          page in the browser cannot quietly write readings. That is not a substitute for real
          authentication on the open internet.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Install on your phone</h2>
        </div>
        <p className="muted">
          Open the site in Chrome or Safari, then choose <strong>Add to Home Screen</strong> or{' '}
          <strong>Install app</strong>. The app shell is cached for quick launching; readings are
          always fetched live, and the PWA never writes while offline.
        </p>
      </section>
    </div>
  )
}
