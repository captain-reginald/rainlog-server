import { amountValue, formatAxis, formatMonthShort, formatShortDate } from '../lib/format'
import { lastNDays, monthlyTotals, type Entries } from '../lib/model'
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

export function ClimateMonthlyChart({
  entries,
  year,
  units,
  monthlyTenths,
  ariaLabel,
}: {
  entries: Entries
  year: number
  units: Units
  monthlyTenths: number[]
  ariaLabel: string
}) {
  const height = 320
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right
  const plotHeight = height - MARGIN.top - MARGIN.bottom
  const actual = monthlyTotals(entries, year).map((tenths) => amountValue(tenths, units))
  const normal = monthlyTenths.map((tenths) => amountValue(tenths, units))
  const max = niceCeil(Math.max(...actual, ...normal, 0.1))
  const slot = plotWidth / 12
  const barWidth = Math.min(20, slot * 0.3)
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const labels = Array.from({ length: 12 }, (_, month) => formatMonthShort(month))

  return (
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
      {labels.map((label, index) => {
        const center = MARGIN.left + index * slot + slot / 2
        const mine = actual[index] ?? 0
        const average = normal[index] ?? 0
        const mineHeight = (mine / max) * plotHeight
        const averageHeight = (average / max) * plotHeight
        return (
          <g key={label}>
            <rect
              className={mine > 0 ? 'chart-bar' : 'chart-bar chart-bar-empty'}
              x={center - barWidth - 2}
              y={MARGIN.top + plotHeight - Math.max(mineHeight, 1.5)}
              width={barWidth}
              height={Math.max(mineHeight, 1.5)}
              rx={3}
            >
              <title>{`${label}: ${formatAxis(mine, units)} ${units} recorded`}</title>
            </rect>
            <rect
              className="chart-bar chart-bar-normal"
              x={center + 2}
              y={MARGIN.top + plotHeight - Math.max(averageHeight, 1.5)}
              width={barWidth}
              height={Math.max(averageHeight, 1.5)}
              rx={3}
            >
              <title>{`${label}: ${formatAxis(average, units)} ${units} average`}</title>
            </rect>
            <text
              className="chart-label"
              x={center}
              y={height - MARGIN.bottom + 22}
              textAnchor="middle"
            >
              {label}
            </text>
          </g>
        )
      })}
      <text className="chart-axis-unit" x={MARGIN.left - 10} y={MARGIN.top - 8} textAnchor="end">
        {units}
      </text>
    </svg>
  )
}
