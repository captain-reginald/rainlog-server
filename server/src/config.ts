import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AppConfig {
  host: string
  port: number
  dataDir: string
  webDir: string
  snapshotRetention: number
  snapshotIntervalSec: number
  trustProxy: boolean
  version: string
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function boolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const defaultWebDir = path.resolve(here, '../../web/dist')
  return {
    host: env.RAINLOG_HOST?.trim() || '0.0.0.0',
    port: positiveInt(env.RAINLOG_PORT, 8080),
    dataDir: path.resolve(env.RAINLOG_DATA_DIR?.trim() || path.join(process.cwd(), 'data')),
    webDir: path.resolve(env.RAINLOG_WEB_DIR?.trim() || defaultWebDir),
    snapshotRetention: positiveInt(env.RAINLOG_SNAPSHOT_RETENTION, 100),
    snapshotIntervalSec: positiveInt(env.RAINLOG_SNAPSHOT_INTERVAL, 3600),
    trustProxy: boolean(env.RAINLOG_TRUST_PROXY, false),
    version: env.RAINLOG_VERSION?.trim() || '1.0.0',
  }
}
