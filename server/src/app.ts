import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { z } from 'zod'
import { ImportParseError, parseImport, toCsv, toJson } from './importers.js'
import {
  ConflictError,
  CorruptDataError,
  MAX_TENTHS,
  NotFoundError,
  RainlogStore,
  ValidationError,
} from './storage.js'

export interface BuildAppOptions {
  dataDir: string
  webDir?: string | undefined
  snapshotRetention?: number | undefined
  snapshotIntervalSec?: number | undefined
  trustProxy?: boolean | undefined
  version?: string | undefined
  logger?: boolean | object | undefined
}

export interface BuiltApp {
  app: FastifyInstance
  store: RainlogStore
}

const setEntryBody = z.object({
  tenths: z.number().int().min(1).max(MAX_TENTHS).nullable(),
  expectedPrevious: z.number().int().min(0).max(MAX_TENTHS).nullable().optional(),
  force: z.boolean().optional(),
})

const importBody = z.object({
  content: z.string().min(1).max(2_000_000),
  format: z.enum(['auto', 'json', 'csv']).default('auto'),
  dryRun: z.boolean().default(false),
  replaceAll: z.boolean().default(false),
  ifMatch: z.string().min(1).max(128).optional(),
  force: z.boolean().optional(),
})

const prefsBody = z.object({
  units: z.enum(['in', 'mm']).default('in'),
  customDays: z.number().int().min(1).max(365).default(14),
})

const originBody = z.object({}).passthrough()

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new ValidationError('Invalid request body', parsed.error.flatten())
  return parsed.data
}

function localDateStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export async function buildApp(options: BuildAppOptions): Promise<BuiltApp> {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: options.trustProxy ?? false,
  })
  const store = new RainlogStore({
    dataDir: options.dataDir,
    snapshotRetention: options.snapshotRetention,
    snapshotIntervalSec: options.snapshotIntervalSec,
  })
  await store.init()
  const version = options.version ?? '1.0.0'
  const mutating = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
  const buckets = new Map<string, number[]>()
  let requestCount = 0

  const rateLimited = (ip: string): boolean => {
    const now = Date.now()
    const recent = (buckets.get(ip) ?? []).filter((time) => now - time < 60_000)
    if (recent.length >= 120) {
      buckets.set(ip, recent)
      return true
    }
    recent.push(now)
    buckets.set(ip, recent)
    requestCount += 1
    if (requestCount % 500 === 0) {
      for (const [key, times] of buckets) {
        if (times.every((time) => now - time >= 60_000)) buckets.delete(key)
      }
    }
    return false
  }

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('X-Frame-Options', 'DENY')
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'",
    )
    if (!request.url.startsWith('/api')) return
    reply.header('Cache-Control', 'no-store')
    if (!mutating.has(request.method)) return
    if (rateLimited(request.ip)) {
      return reply.code(429).send({ error: 'rate_limited', message: 'Too many writes; slow down' })
    }
    const origin = headerValue(request.headers.origin)
    if (origin === 'null') {
      return reply.code(403).send({ error: 'forbidden', message: 'Cross-origin writes are not allowed' })
    }
    if (origin) {
      try {
        const originHost = new URL(origin).host
        const requestHost = headerValue(request.headers.host)
        if (!(options.trustProxy ?? false) && requestHost && originHost !== requestHost) {
          return reply.code(403).send({ error: 'forbidden', message: 'Cross-origin writes are not allowed' })
        }
      } catch {
        return reply.code(403).send({ error: 'forbidden', message: 'Invalid Origin header' })
      }
    }
    const contentType = String(headerValue(request.headers['content-type']) ?? '').toLowerCase()
    if (!contentType.startsWith('application/json')) {
      return reply.code(415).send({ error: 'unsupported_media_type', message: 'Send application/json' })
    }
  })

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ConflictError) {
      return reply.code(409).send({ error: 'conflict', message: error.message, state: await store.state() })
    }
    if (error instanceof CorruptDataError) {
      return reply.code(422).send({ error: 'corrupt_data', message: error.message, parseError: error.parseError })
    }
    if (error instanceof ValidationError) {
      return reply.code(400).send({ error: 'invalid_request', message: error.message, details: error.details })
    }
    if (error instanceof ImportParseError) {
      return reply.code(400).send({ error: 'invalid_import', message: error.message })
    }
    if (error instanceof NotFoundError) {
      return reply.code(404).send({ error: 'not_found', message: error.message })
    }
    const statusCode = (error as { statusCode?: number }).statusCode
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      const message = error instanceof Error ? error.message : 'Bad request'
      return reply.code(statusCode).send({ error: 'bad_request', message })
    }
    request.log.error(error)
    return reply.code(500).send({ error: 'internal', message: 'Internal server error' })
  })

  app.get('/api/health', async () => {
    const writable = await fs.access(store.dataDir, fs.constants.W_OK).then(
      () => true,
      () => false,
    )
    return { ok: true, version, dataWritable: writable }
  })

  app.get('/api/state', async () => store.state())

  app.put('/api/entries/:date', async (request, reply) => {
    const params = z.object({ date: z.string() }).parse(request.params)
    const body = parseBody(setEntryBody, request.body ?? {})
    await store.setEntry(params.date, body.tenths, {
      ifMatch: headerValue(request.headers['if-match']),
      expectedPrevious: body.expectedPrevious,
      force: body.force,
    })
    return reply.send(await store.state())
  })

  app.post('/api/import', async (request, reply) => {
    const body = parseBody(importBody, request.body ?? {})
    const parsed = parseImport(body.content, body.format)
    const report = await store.importEntries(parsed.entries, {
      replaceAll: body.replaceAll,
      dryRun: body.dryRun,
      ifMatch: body.ifMatch ?? headerValue(request.headers['if-match']),
      force: body.force,
    })
    report.warnings = [...parsed.warnings, ...report.warnings]
    if (body.dryRun) return reply.send({ report })
    return reply.send({ report, state: await store.state() })
  })

  app.get('/api/export.json', async (_request, reply) => {
    const snapshot = await store.read()
    if (snapshot.parseError) throw new CorruptDataError(snapshot.parseError)
    return reply
      .type('application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="rainlog-${localDateStamp()}.json"`)
      .send(toJson(snapshot.entries))
  })

  app.get('/api/export.csv', async (_request, reply) => {
    const snapshot = await store.read()
    if (snapshot.parseError) throw new CorruptDataError(snapshot.parseError)
    return reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="rainlog-${localDateStamp()}.csv"`)
      .send(toCsv(snapshot.entries))
  })

  app.get('/api/preferences', async () => store.readPrefs())

  app.put('/api/preferences', async (request, reply) => {
    const body = parseBody(prefsBody, request.body ?? {})
    const prefs = await store.writePrefs({ version: 1, ...body })
    return reply.send(prefs)
  })

  app.get('/api/snapshots', async () => ({ snapshots: await store.listSnapshots() }))

  app.post('/api/snapshots', async (request, reply) => {
    parseBody(originBody, request.body ?? {})
    const snapshot = await store.snapshotNow('manual')
    return reply.code(201).send({ snapshot, snapshots: await store.listSnapshots() })
  })

  app.get('/api/snapshots/:name', async (request, reply) => {
    const params = z.object({ name: z.string() }).parse(request.params)
    const text = await store.readSnapshot(params.name)
    return reply
      .type('application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${params.name}"`)
      .send(text)
  })

  app.post('/api/snapshots/:name/restore', async (request, reply) => {
    const params = z.object({ name: z.string() }).parse(request.params)
    parseBody(originBody, request.body ?? {})
    await store.restoreSnapshot(params.name)
    return reply.send(await store.state())
  })

  if (options.webDir && existsSync(options.webDir)) {
    await app.register(fastifyStatic, {
      root: options.webDir,
      prefix: '/',
      setHeaders(reply, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          reply.header('Cache-Control', 'public, max-age=31536000, immutable')
        } else if (filePath.endsWith('.html') || filePath.endsWith('.webmanifest') || filePath.endsWith('sw.js')) {
          reply.header('Cache-Control', 'no-cache')
        }
      },
    })
  }

  app.setNotFoundHandler(async (request, reply) => {
    if (
      request.method === 'GET' &&
      !request.url.startsWith('/api') &&
      options.webDir &&
      existsSync(path.join(options.webDir, 'index.html')) &&
      String(headerValue(request.headers.accept) ?? '').includes('text/html')
    ) {
      return reply.type('text/html; charset=utf-8').sendFile('index.html')
    }
    return reply.code(404).send({ error: 'not_found', message: 'Not found' })
  })

  return { app, store }
}
