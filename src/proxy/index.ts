import { Proxy } from 'http-mitm-proxy'
import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'
import zlib from 'zlib'
import type { CapturedRequest } from '../types.js'
import { installProxyLogFilter } from './log-filter.js'

// Servers send response bodies compressed per the Content-Encoding header.
// Decompress before we attempt to decode them as text, otherwise the stored
// body is raw gzip/brotli bytes that render as mojibake in the UI.
function decompressBody(buf: Buffer, encoding?: string): Buffer {
  try {
    switch ((encoding || '').trim().toLowerCase()) {
      case 'gzip':
      case 'x-gzip':
        return zlib.gunzipSync(buf)
      case 'br':
        return zlib.brotliDecompressSync(buf)
      case 'deflate':
        // Some servers send raw deflate without zlib headers; fall back to that.
        try {
          return zlib.inflateSync(buf)
        } catch {
          return zlib.inflateRawSync(buf)
        }
      default:
        return buf
    }
  } catch {
    // If decompression fails (partial/corrupt stream), keep the raw bytes.
    return buf
  }
}

// Only decode bodies we're confident are text. Binary types (images, fonts,
// media, archives) would otherwise become garbage when forced through utf8.
function isTextualContentType(contentType?: string): boolean {
  if (!contentType) return true
  const ct = contentType.toLowerCase()
  return (
    ct.startsWith('text/') ||
    ct.includes('json') ||
    ct.includes('xml') ||
    ct.includes('javascript') ||
    ct.includes('ecmascript') ||
    ct.includes('html') ||
    ct.includes('csv') ||
    ct.includes('x-www-form-urlencoded')
  )
}

export class ProxyServer extends EventEmitter {
  private proxy: Proxy
  readonly port: number
  // Monotonic capture sequence, assigned when each request *starts* (onRequest),
  // not when it completes. This becomes the row's order_id so requests sort by
  // initiation order; otherwise a slow-responding request that started first
  // would sort after a fast one that started later (completion order).
  private orderSeq = 0

  constructor(port = 8080) {
    super()
    this.port = port
    this.proxy = new Proxy()
  }

  // Restart capture numbering from 1. Called when a recording starts so order_id
  // is 1-based per recording. Safe because the proxied browser is only spawned
  // after the recording is active (see RecordingController.start), so no proxied
  // traffic is ever in flight across the reset.
  resetOrder(): void {
    this.orderSeq = 0
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // http-mitm-proxy logs benign connection/parse errors directly to console
      // before this handler runs; this scoped filter drops only that noise.
      installProxyLogFilter()

      this.proxy.onError((ctx, err) => {
        // silently ignore connection errors (browser cancel, etc)
      })

      this.proxy.onRequest((ctx, callback) => {
        const startTime = Date.now()
        const sendStart = Date.now()
        // Capture initiation order now; the entry is only emitted at onResponseEnd.
        const orderId = ++this.orderSeq

        // collect request body
        const reqChunks: Buffer[] = []
        ctx.onRequestData((ctx, chunk, cb) => {
          reqChunks.push(chunk)
          return cb(null, chunk)
        })

        // collect response
        const resChunks: Buffer[] = []
        let waitTime = 0

        ctx.onRequestEnd((ctx, cb) => {
          waitTime = Date.now()
          return cb()
        })

        ctx.onResponseData((ctx, chunk, cb) => {
          resChunks.push(chunk)
          return cb(null, chunk)
        })

        ctx.onResponseEnd((ctx, cb) => {
          const endTime = Date.now()
          const sendDuration = Math.max(0, waitTime - sendStart)
          const waitDuration = Math.max(0, endTime - waitTime - (resChunks.length > 0 ? 1 : 0))
          const receiveDuration = Math.max(0, endTime - waitTime)

          const req = ctx.clientToProxyRequest
          const res = ctx.serverToProxyResponse

          const host = req.headers.host || ctx.proxyToServerRequestOptions?.host || ''
          const path = req.url || '/'
          const protocol = ctx.isSSL ? 'https' : 'http'

          let responseBody: string | undefined
          let responseLength: number | undefined
          if (resChunks.length) {
            const raw = Buffer.concat(resChunks)
            const decompressed = decompressBody(raw, res?.headers['content-encoding'] as string | undefined)
            responseLength = decompressed.length
            if (isTextualContentType(res?.headers['content-type'] as string | undefined)) {
              responseBody = decompressed.toString('utf8')
            } else {
              responseBody = `[binary ${res?.headers['content-type'] || 'data'}, ${decompressed.length} bytes]`
            }
          }

          // The stored body is decompressed, so the original content-encoding no
          // longer applies and content-length no longer matches. Drop them so
          // exports/consumers don't try to re-decompress or trust a stale length.
          let responseHeaders = res?.headers as Record<string, string> | undefined
          if (responseHeaders) {
            const { 'content-encoding': _ce, 'content-length': _cl, ...rest } = responseHeaders
            responseHeaders = rest
            if (responseLength !== undefined) responseHeaders['content-length'] = String(responseLength)
          }

          const entry: CapturedRequest = {
            id: uuidv4(),
            orderId,
            timestamp: new Date(startTime).toISOString(),
            method: req.method || 'GET',
            host,
            path,
            url: `${protocol}://${host}${path}`,
            httpVersion: `HTTP/${req.httpVersion}`,
            requestHeaders: req.headers as Record<string, string>,
            requestBody: reqChunks.length ? Buffer.concat(reqChunks).toString('utf8') : undefined,
            statusCode: res?.statusCode,
            statusText: res?.statusMessage,
            responseHeaders,
            responseBody,
            timings: {
              send: sendDuration,
              wait: waitDuration,
              receive: receiveDuration,
              total: endTime - startTime,
            },
          }

          this.emit('request', entry)
          return cb()
        })

        return callback()
      })

      // Bind to IPv4 loopback explicitly: http-mitm-proxy defaults to "localhost",
      // which resolves to IPv6 ::1 on macOS, but Chrome connects via 127.0.0.1 (IPv4).
      this.proxy.listen({ host: '127.0.0.1', port: this.port, sslCaDir: `${process.env.HOME}/.mitmproxy` }, (err?: Error | null) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  stop(): void {
    this.proxy.close()
  }
}
