import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type ChangeEvent } from 'react'
import {
  ApiError,
  createSnapshot,
  importData,
  listSnapshots,
  restoreSnapshot,
  snapshotDownloadUrl,
} from '../api'
import { useToast } from '../components/Toast'
import { formatDateTime, formatFileSize } from '../lib/format'
import { apiErrorMessage, useRainlogState } from '../lib/hooks'
import type { ImportReport, StatePayload } from '../types'

export function Data() {
  const stateQuery = useRainlogState()
  const state = stateQuery.data
  const queryClient = useQueryClient()
  const { notify } = useToast()
  const [content, setContent] = useState('')
  const [format, setFormat] = useState<'auto' | 'json' | 'csv'>('auto')
  const [replaceAll, setReplaceAll] = useState(false)
  const [force, setForce] = useState(false)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const snapshotsQuery = useQuery({ queryKey: ['snapshots'], queryFn: listSnapshots })

  const createSnapshotMutation = useMutation({
    mutationFn: createSnapshot,
    onSuccess: (data) => {
      queryClient.setQueryData(['snapshots'], { snapshots: data.snapshots })
      notify('Snapshot created.', 'success')
    },
    onError: (error) => notify(apiErrorMessage(error), 'error'),
  })

  const restoreMutation = useMutation({
    mutationFn: restoreSnapshot,
    onSuccess: (nextState) => {
      queryClient.setQueryData(['state'], nextState)
      void queryClient.invalidateQueries({ queryKey: ['snapshots'] })
      notify('Snapshot restored.', 'success')
    },
    onError: (error) => notify(apiErrorMessage(error), 'error'),
  })

  const runImport = async (dryRun: boolean) => {
    if (content.trim() === '') {
      notify('Paste or choose a file first.', 'warn')
      return
    }
    setBusy(true)
    try {
      const response = await importData({
        content,
        format,
        dryRun,
        replaceAll,
        ifMatch: state?.etag,
        force,
      })
      setReport(response.report)
      if (!dryRun) {
        if (response.state) queryClient.setQueryData<StatePayload>(['state'], response.state)
        void queryClient.invalidateQueries({ queryKey: ['snapshots'] })
        notify(
          `Import applied: ${response.report.added} added, ${response.report.updated} updated, ${response.report.removed} removed.`,
          response.report.rejected.length > 0 ? 'warn' : 'success',
        )
      } else {
        notify('Dry run finished; nothing was written.', 'info')
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.body.state) {
        queryClient.setQueryData(['state'], error.body.state)
        notify('The file changed since the preview. Review the new state and try again.', 'warn')
      } else if (error instanceof ApiError && error.status === 422) {
        notify(
          'rainlog.json is not valid JSON. Repair it on the host, or re-import with “Replace all” and “Force” checked.',
          'error',
        )
      } else {
        notify(apiErrorMessage(error), 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  const onFileChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setContent(await file.text())
    setReport(null)
    notify(`Loaded ${file.name}.`, 'info')
    event.target.value = ''
  }

  const snapshots = snapshotsQuery.data?.snapshots ?? []

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Data</p>
          <h1>Import, export, recover</h1>
        </div>
        <p className="muted page-head-note">
          The shared file always stays in the plugin’s format.
        </p>
      </div>

      {state?.parseError ? (
        <div className="banner banner-error">
          <strong>rainlog.json can’t be parsed.</strong>
          <span>{state.parseError}</span>
          <span>
            Writes are blocked so nothing is overwritten. Repair the file on the host, or import a
            replacement with <em>Replace all</em> and <em>Force</em> enabled below.
          </span>
        </div>
      ) : null}

      {state && state.conflicts.length > 0 ? (
        <div className="banner banner-warn">
          <strong>Syncing conflict copies found.</strong>
          <span>
            The server ignores these files. Compare and merge them on the host, then delete the
            extra copies.
          </span>
          <ul>
            {state.conflicts.map((file) => (
              <li key={file.name}>{file.name}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="card">
        <div className="card-head">
          <h2>Export</h2>
          <span className="muted">{Object.keys(state?.entries ?? {}).length} recorded days</span>
        </div>
        <div className="button-row">
          <a className="button primary" href="/api/export.csv" download>
            Download CSV
          </a>
          <a className="button ghost" href="/api/export.json" download>
            Download JSON
          </a>
        </div>
        <p className="card-note">
          JSON is exactly the plugin’s <code>{'{"entries": {"YYYY-MM-DD": tenths}}'}</code> shape. CSV
          has <code>date,tenths,inches</code> columns, which the importer also accepts.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Import</h2>
          <span className="muted">Preview before writing</span>
        </div>
        <div className="import-controls">
          <label className="field">
            <span>Format</span>
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as 'auto' | 'json' | 'csv')}
            >
              <option value="auto">Detect automatically</option>
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={replaceAll} onChange={(event) => setReplaceAll(event.target.checked)} />
            <span>Replace all existing days</span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
            <span>Force through a corrupt file</span>
          </label>
        </div>
        <label className="field">
          <span>Paste JSON or CSV</span>
          <textarea
            rows={8}
            value={content}
            onChange={(event) => {
              setContent(event.target.value)
              setReport(null)
            }}
            placeholder={'date,tenths\n2026-11-14,23\n2026-11-13,12'}
            spellCheck={false}
          />
        </label>
        <div className="button-row">
          <button type="button" className="ghost" onClick={() => fileInput.current?.click()}>
            Choose file…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,.csv,application/json,text/csv,text/plain"
            hidden
            onChange={(event) => void onFileChosen(event)}
          />
          <button type="button" className="ghost" disabled={busy} onClick={() => void runImport(true)}>
            {busy ? 'Working…' : 'Dry run'}
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void runImport(false)}>
            Apply import
          </button>
        </div>

        {report ? (
          <div className="report">
            <h3>{report.dryRun ? 'Dry run' : 'Import result'}</h3>
            <div className="report-grid">
              <span>Added <strong>{report.added}</strong></span>
              <span>Updated <strong>{report.updated}</strong></span>
              <span>Unchanged <strong>{report.unchanged}</strong></span>
              <span>Removed <strong>{report.removed}</strong></span>
              <span>Rejected <strong>{report.rejected.length}</strong></span>
              <span>Rows <strong>{report.total}</strong></span>
            </div>
            {report.warnings.length > 0 ? (
              <ul className="report-warnings">
                {report.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            {report.rejected.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date / key</th>
                      <th>Value</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rejected.map((row, index) => (
                      <tr key={`${row.date}-${index}`}>
                        <td>{row.date}</td>
                        <td>{String(row.value)}</td>
                        <td>{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Snapshots</h2>
          <button
            type="button"
            className="ghost small"
            disabled={createSnapshotMutation.isPending}
            onClick={() => createSnapshotMutation.mutate()}
          >
            {createSnapshotMutation.isPending ? 'Creating…' : 'Create snapshot now'}
          </button>
        </div>
        <p className="muted">
          Saved in <code>.rainlog-backups/</code> inside the data volume. The server also snapshots
          before overwriting an externally changed file, and hourly while in use.
        </p>
        {snapshots.length === 0 ? (
          <p className="muted">No snapshots yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Snapshot</th>
                  <th>When</th>
                  <th>Size</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snapshot) => (
                  <tr key={snapshot.name}>
                    <td>
                      <span className="snapshot-name">{snapshot.name}</span>
                      <span className="snapshot-reason">{snapshot.reason}</span>
                    </td>
                    <td>{formatDateTime(snapshot.mtimeMs)}</td>
                    <td>{formatFileSize(snapshot.size)}</td>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="ghost small"
                        disabled={restoreMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`Restore ${snapshot.name}? The current file is snapshotted first.`)) {
                            restoreMutation.mutate(snapshot.name)
                          }
                        }}
                      >
                        Restore
                      </button>
                      <a className="ghost small button" href={snapshotDownloadUrl(snapshot.name)} download>
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Compatibility notes</h2>
        </div>
        <div className="compat-grid">
          <div>
            <h3>Shared file</h3>
            <p>
              <code>rainlog.json</code> in the data volume is the same file the Omarchy plugin reads
              and writes. Point the plugin’s <em>Data file path</em> setting at the synced copy.
            </p>
            <pre>{'{\n  "entries": {\n    "2026-11-14": 23\n  }\n}'}</pre>
          </div>
          <div>
            <h3>Web-only settings</h3>
            <p>
              Units and the custom window live in <code>rainlog-web.json</code> beside the data file.
              They are never written into <code>rainlog.json</code>, because the plugin rewrites that
              entire file from memory when it saves.
            </p>
            <h3>Syncing</h3>
            <p>
              Mount the <strong>directory</strong>, not the single file, so atomic replaces are
              visible to the host and the sync client. Exclude <code>.rainlog-backups/</code> and
              hidden <code>*.tmp-*</code> files.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
