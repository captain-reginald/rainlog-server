import { formatValue } from '../lib/format'
import type { Units } from '../types'

interface StatCardProps {
  label: string
  tenths: number
  units: Units
  rangeLabel: string
  onPrev?: () => void
  onNext?: () => void
}

export function StatCard({ label, tenths, units, rangeLabel, onPrev, onNext }: StatCardProps) {
  return (
    <article className="stat-card">
      <div className="stat-head">
        <span className="stat-label">{label}</span>
        {onPrev || onNext ? (
          <div className="stat-nav">
            <button type="button" className="icon-button" onClick={onPrev} aria-label={`Previous ${label}`}>
              ‹
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={onNext}
              aria-label={`Next ${label}`}
              disabled={!onNext}
            >
              ›
            </button>
          </div>
        ) : null}
      </div>
      <div className="stat-value">
        {formatValue(tenths, units)}
        <span className="stat-unit">{units}</span>
      </div>
      <div className="stat-range">{rangeLabel}</div>
    </article>
  )
}
