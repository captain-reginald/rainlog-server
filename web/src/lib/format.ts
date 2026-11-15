import { parseDateKey } from './model'
import type { Units } from '../types'

export function tenthsToInches(tenths: number): number {
  return tenths / 10
}

export function tenthsToMillimetres(tenths: number): number {
  return tenths * 2.54
}

export function amountValue(tenths: number, units: Units): number {
  return units === 'mm' ? tenthsToMillimetres(tenths) : tenthsToInches(tenths)
}

export function formatValue(tenths: number, units: Units): string {
  if (units === 'mm') {
    const mm = tenthsToMillimetres(tenths)
    return mm > 0 && mm < 10 ? mm.toFixed(1) : Math.round(mm).toString()
  }
  return tenthsToInches(tenths).toFixed(1)
}

export function formatAmount(tenths: number, units: Units): string {
  return `${formatValue(tenths, units)} ${units}`
}

export function formatAxis(value: number, units: Units): string {
  if (units === 'mm') return value < 10 ? value.toFixed(1) : Math.round(value).toString()
  return value.toFixed(1)
}

const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const longDate = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})
const monthYear = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const monthShort = new Intl.DateTimeFormat(undefined, { month: 'short' })
const monthLong = new Intl.DateTimeFormat(undefined, { month: 'long' })
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short' })

export function formatShortDate(key: string): string {
  const date = parseDateKey(key)
  return date ? shortDate.format(date) : key
}

export function formatLongDate(key: string): string {
  const date = parseDateKey(key)
  return date ? longDate.format(date) : key
}

export function formatMonthYear(date: Date): string {
  return monthYear.format(date)
}

export function formatMonthLong(date: Date): string {
  return monthLong.format(date)
}

export function formatMonthShort(monthIndex: number): string {
  return monthShort.format(new Date(2026, monthIndex, 1))
}

export function formatWeekdayShort(date: Date): string {
  return weekdayShort.format(date)
}

export function formatRange(start: Date, end: Date): string {
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${monthLong.format(start)} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${shortDate.format(start)} – ${shortDate.format(end)}, ${end.getFullYear()}`
  }
  return `${shortDate.format(start)}, ${start.getFullYear()} – ${shortDate.format(end)}, ${end.getFullYear()}`
}

export function formatWindowLabel(start: Date, end: Date, singleDay: boolean): string {
  if (singleDay) {
    return longDate.format(start)
  }
  return formatRange(start, end)
}

export function monthLabel(year: number, month: number): string {
  return monthYear.format(new Date(year, month, 1, 12))
}

export type ParsedInput = { kind: 'value'; tenths: number } | { kind: 'clear' } | { kind: 'invalid' }

export function parseTenthsInput(input: string): ParsedInput {
  const trimmed = input.trim()
  if (trimmed === '') return { kind: 'clear' }
  if (!/^\d+$/.test(trimmed)) return { kind: 'invalid' }
  const value = Number.parseInt(trimmed, 10)
  if (value === 0) return { kind: 'clear' }
  if (value < 1 || value > 9999) return { kind: 'invalid' }
  return { kind: 'value', tenths: value }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms))
}
