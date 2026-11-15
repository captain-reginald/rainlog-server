import { buildApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()

const { app, store } = await buildApp({
  dataDir: config.dataDir,
  webDir: config.webDir,
  snapshotRetention: config.snapshotRetention,
  snapshotIntervalSec: config.snapshotIntervalSec,
  trustProxy: config.trustProxy,
  version: config.version,
})

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down')
  try {
    await app.close()
    process.exit(0)
  } catch (error) {
    app.log.error(error, 'failed to shut down cleanly')
    process.exit(1)
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

try {
  await app.listen({ host: config.host, port: config.port })
  app.log.info(
    {
      dataFile: store.dataPath,
      snapshots: store.snapshotDir,
      retention: config.snapshotRetention,
      snapshotIntervalSec: config.snapshotIntervalSec,
      trustProxy: config.trustProxy,
    },
    'rain log server ready',
  )
  app.log.warn(
    'No authentication is built in. Bind to localhost or put this behind a reverse proxy, VPN, or Tailscale.',
  )
} catch (error) {
  app.log.error(error, 'failed to start')
  process.exit(1)
}
