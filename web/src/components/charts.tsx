import { amountValue, formatAxis, formatMonthShort, formatShortDate } from '../lib/format'
import {
  cumulativeSeason,
  lastNDays,
  monthlyTotals,
  seasonName,
  seasonWindow,
  type Entries,
} from '../lib/model'
import type { Units } from '../types'

const WIDTH = 760
const HEIGHT = 300
const MARGIN = { top: 22, right: 18, bottom: 42, left: 54 }

function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const padded = value * 1.1
  const exponent = Math.floor(Math.log10(padded))
  const base = 10 ** exponent
  const normalized = padded / base
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
  const step = steps.find((candidate) => normalized <= candidate) ?? 10
  return step * base
}

interface BarChartProps {
  values: number[]
  labels: string[]
  units: Units
  height?: number
  showValues?: boolean
  labelEvery?: number
  ariaLabel: string
}

function BarChart({ values, labels, units, height = HEIGHT, showValues, labelEvery = 1, ariaLabel }: BarChartProps) {
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right
  const plotHeight = height - MARGIN.top - MARGIN.bottom
  const max = niceCeil(Math.max(...values, 0.1))
  const count = Math.max(values.length, 1)
  const slot = plotWidth / count
  const barWidth = Math.min(42, slot * 0.62)
  const ticks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${WIDTH} ${height}`}
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="xMidYMid meet"
    >
      {ticks.map((fraction) => {
        const y = MARGIN.top + plotHeight - fraction * plotHeight
        return (
          <g key={fraction}>
            <line
              className="chart-grid"
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={y}
              y2={y}
            />
            <text className="chart-tick" x={MARGIN.left - 10} y={y + 4} textAnchor="end">
              {formatAxis(fraction * max, units)}
            </text>
          </g>
        )
      })}
      {values.map((value, index) => {
        const x = MARGIN.left + index * slot + (slot - barWidth) / 2
        const barHeight = max > 0 ? (value / max) * plotHeight : 0
        const y = MARGIN.top + plotHeight - barHeight
        return (
          <g key={labels[index] ?? index}>
            <rect
              className={value > 0 ? 'chart-bar' : 'chart-bar chart-bar-empty'}
              x={x}
              y={value > 0 ? y : MARGIN.top + plotHeight - 1}
              width={barWidth}
              height={value > 0 ? Math.max(barHeight, 1.5) : 1.5}
              rx={3}
            >
              <title>{`${labels[index] ?? ''}: ${formatAxis(value, units)} ${units}`}</title>
            </rect>
            {showValues && value > 0 ? (
              <text className="chart-value" x={x + barWidth / 2} y={y - 6} textAnchor="middle">
                {formatAxis(value, units)}
              </text>
            ) : null}
            {index % labelEvery === 0 || index === values.length - 1 ? (
              <text
                className="chart-label"
                x={MARGIN.left + index * slot + slot / 2}
                y={height - MARGIN.bottom + 22}
                textAnchor="middle"
              >
                {labels[index] ?? ''}
              </text>
            ) : null}
          </g>
        )
      })}
      <text className="chart-axis-unit" x={MARGIN.left - 10} y={MARGIN.top - 8} textAnchor="end">
        {units}
      </text>
    </svg>
  )
}

export function MonthlyChart({ entries, year, units }: { entries: Entries; year: number; units: Units }) {
  const totals = monthlyTotals(entries, year)
  const values = totals.map((tenths) => amountValue(tenths, units))
  const labels = Array.from({ length: 12 }, (_, month) => formatMonthShort(month))
  return <BarChart values={values} labels={labels} units={units} showValues ariaLabel={`Monthly rainfall for ${year}`} />
}

export function TrendChart({ entries, units, days = 30 }: { entries: Entries; units: Units; days?: number }) {
  const data = lastNDays(entries, days)
  const values = data.map((day) => amountValue(day.value, units))
  const labels = data.map((day) => formatShortDate(day.key))
  return (
    <BarChart
      values={values}
      labels={labels}
      units={units}
      height={220}
      labelEvery={5}
      ariaLabel={`Daily rainfall for the last ${days} days`}
    />
  )
}

interface LineSeries {
  label: string
  values: number[]
  className: string
}

function LineChart({
  series,
  units,
  ariaLabel,
  xLabels,
}: {
  series: LineSeries[]
  units: Units
  ariaLabel: string
  xLabels: { at: number; label: string }[]
}) {
  const height = 320
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right
  const plotHeight = height - MARGIN.top - MARGIN.bottom
  const max = niceCeil(Math.max(...series.flatMap((line) => line.values), 0.1))
  const longest = Math.max(...series.map((line) => line.values.length), 2)
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const xFor = (index: number) => MARGIN.left + (index / (longest - 1)) * plotWidth
  const yFor = (value: number) => MARGIN.top + plotHeight - (value / max) * plotHeight

  return (
    <div>
      <div className="chart-legend">
        {series.map((line) => (
          <span key={line.label} className="legend-item">
            <span className={`legend-swatch ${line.className}`} />
            {line.label}
          </span>
        ))}
      </div>
      <svg className="chart" viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={ariaLabel}>
        {ticks.map((fraction) => {
          const y = MARGIN.top + plotHeight - fraction * plotHeight
          return (
            <g key={fraction}>
              <line className="chart-grid" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y} y2={y} />
              <text className="chart-tick" x={MARGIN.left - 10} y={y + 4} textAnchor="end">
                {formatAxis(fraction * max, units)}
              </text>
            </g>
          )
        })}
        {series.map((line) => {
          const points = line.values.map((value, index) => `${xFor(index)},${yFor(value)}`).join(' ')
          const lastIndex = line.values.length - 1
          const lastValue = line.values[lastIndex]
          return (
            <g key={line.label}>
              <polyline className={`chart-line ${line.className}`} points={points} />
              {lastValue !== undefined && lastIndex >= 0 ? (
                <circle className={`chart-point ${line.className}`} cx={xFor(lastIndex)} cy={yFor(lastValue)} r={4}>
                  <title>{`${line.label}: ${formatAxis(lastValue, units)} ${units}`}</title>
                </circle>
              ) : null}
            </g>
          )
        })}
        {xLabels.map((tick) => (
          <text
            key={`${tick.at}-${tick.label}`}
            className="chart-label"
            x={xFor(tick.at)}
            y={height - MARGIN.bottom + 20}
            textAnchor={tick.at === 0 ? 'start' : tick.at === longest - 1 ? 'end' : 'middle'}
          >
            {tick.label}
          </text>
        ))}
        <text className="chart-axis-unit" x={MARGIN.left - 10} y={MARGIN.top - 8} textAnchor="end">
          {units}
        </text>
      </svg>
    </div>
  )
}

export function SeasonCompareChart({ entries, units }: { entries: Entries; units: Units }) {
  const currentWindow = seasonWindow(0)
  const previousWindow = seasonWindow(1)
  const current = cumulativeSeason(entries, currentWindow.start)
  const previous = cumulativeSeason(entries, previousWindow.start).slice(0, current.length)
  const currentYear = currentWindow.start.getFullYear()
  const previousYear = previousWindow.start.getFullYear()
  const series: LineSeries[] = [
    {
      label: `${currentWindow.name} ${currentYear} so far`,
      values: current.map((point) => amountValue(point.value, units)),
      className: 'series-current',
    },
    {
      label: `${previousWindow.name} ${previousYear} to the same day`,
      values: previous.map((point) => amountValue(point.value, units)),
      className: 'series-previous',
    },
  ]
  const indices = current.length > 0
    ? [...new Set([0, Math.floor((current.length - 1) / 2), current.length - 1])]
    : []
  const xLabels = indices.map((index) => ({
    at: index,
    label: current[index] ? formatShortDate(current[index].key) : '',
  }))

  return (
    <LineChart
      series={series}
      units={units}
      ariaLabel={`Cumulative rainfall for ${seasonName(currentWindow.start)} compared with the previous season`}
      xLabels={xLabels}
    />
  )
}
