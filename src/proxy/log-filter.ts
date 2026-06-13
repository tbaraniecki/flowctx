// http-mitm-proxy logs its own connection errors straight to console.error /
// console.debug (see _onError / the ECONNRESET handler in its proxy.js) BEFORE
// our onError handler runs, so a no-op onError can't silence them. None of this
// is actionable: it's clients aborting TLS connections (socket hang up /
// ECONNRESET), non-HTTP traffic dialing the proxy (Chrome's mcs.android.com
// push tunnel shows up as HPE_INVALID_METHOD parse errors), and routine
// per-host server-startup chatter. This installs a one-time, scoped filter that
// drops only those known-benign lines and passes everything else through.

// The "kind" labels http-mitm-proxy prints as a bare line right before the error.
const PROXY_ERROR_KINDS = new Set([
  'HTTPS_CLIENT_ERROR',
  'HTTPS_SERVER_ERROR',
  'ON_CONNECT_ERROR',
  'ON_REQUEST_ERROR',
  'ON_REQUEST_DATA_ERROR',
  'ON_REQUEST_END_ERROR',
  'ON_REQUESTHEADERS_ERROR',
  'ON_RESPONSE_ERROR',
  'ON_RESPONSE_DATA_ERROR',
  'ON_RESPONSE_END_ERROR',
  'ON_RESPONSEHEADERS_ERROR',
  'OPEN_HTTPS_SERVER_ERROR',
])

// Error codes/messages that mean "the other end went away" or "not HTTP" — noise.
const BENIGN_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ECONNABORTED',
  'ERR_STREAM_DESTROYED',
  'HPE_INVALID_METHOD',
  'HPE_INVALID_CONSTANT',
  'HPE_INVALID_EOF_STATE',
])
const BENIGN_MESSAGES = ['socket hang up']

// console.debug/info chatter the proxy emits per host/connection.
const BENIGN_LOG_PATTERNS = [
  /^Got E\w+ on .+ ignoring\.$/,
  /^starting server for /,
  /^https server started/,
  /^creating SNI context for /,
  /^SNI enabled\./,
]

function isBenignError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const code = (e as { code?: unknown }).code
  if (typeof code === 'string' && BENIGN_CODES.has(code)) return true
  const msg = (e as { message?: unknown }).message
  if (typeof msg === 'string' && BENIGN_MESSAGES.some((m) => msg.includes(m))) return true
  return false
}

let installed = false

export function installProxyLogFilter(): void {
  if (installed) return
  installed = true

  const origError = console.error.bind(console)
  const origDebug = console.debug.bind(console)
  const origInfo = console.info.bind(console)

  // _onError prints the kind label and the error as two back-to-back synchronous
  // calls. Hold a benign-looking kind label and only flush it if the error that
  // immediately follows turns out NOT to be benign, so real errors keep their label.
  let heldKind: string | null = null
  const flushHeldKind = () => {
    if (heldKind !== null) {
      origError(heldKind)
      heldKind = null
    }
  }

  console.error = (...args: unknown[]) => {
    if (args.length === 1 && typeof args[0] === 'string' && PROXY_ERROR_KINDS.has(args[0])) {
      flushHeldKind()
      heldKind = args[0]
      return
    }
    if (heldKind !== null) {
      if (args.length === 1 && isBenignError(args[0])) {
        heldKind = null // drop the label + its benign error
        return
      }
      flushHeldKind()
    }
    if (args.length === 1 && isBenignError(args[0])) return
    origError(...args)
  }

  const dropsAsChatter = (args: unknown[]) =>
    args.length >= 1 &&
    typeof args[0] === 'string' &&
    BENIGN_LOG_PATTERNS.some((re) => re.test(args[0] as string))

  console.debug = (...args: unknown[]) => {
    if (dropsAsChatter(args)) return
    origDebug(...args)
  }
  console.info = (...args: unknown[]) => {
    if (dropsAsChatter(args)) return
    origInfo(...args)
  }
}
