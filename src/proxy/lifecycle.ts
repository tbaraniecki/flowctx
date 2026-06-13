import { spawn, execFileSync, type ChildProcess } from 'child_process'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import type { RequestStore } from '../storage/index.js'
import type { Recording } from '../types.js'

const CHROME_BINARY = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// A spawned recording browser that exits faster than this almost certainly never
// really launched — typically Chrome found our profile already locked and handed
// the request to that existing window, so our launcher exited immediately. Used
// only to log a helpful diagnostic; the handoff itself is prevented up front.
const INSTANT_EXIT_MS = 1500

// Default recording name = local date-time, e.g. "2026-06-11 14:32:05".
function defaultRecordingName(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

export interface RecordingControllerOptions {
  proxyPort: number
  profileDir?: string
  // Invoked at the start of each recording, before the browser is spawned, so
  // capture-order numbering (proxy.resetOrder) restarts at 1 per recording.
  resetCapture?: () => void
}

/**
 * Owns the single active recording and the proxied Chrome it spawns.
 *
 * Option A1 (browser-controlled lifecycle): "Start Recording" creates a
 * recording, marks it active, and spawns an isolated, proxied Chrome. When that
 * Chrome process exits, capture stops automatically. Option A2 (the capture
 * gating in src/index.ts) is the safety net: requests are only ever persisted
 * while getActive() is non-null, so capture stays correct regardless of how the
 * browser was launched.
 */
export class RecordingController {
  private store: RequestStore
  private proxyPort: number
  private profileDir: string
  private resetCapture?: () => void
  private activeId: string | null = null
  private child: ChildProcess | null = null
  private onStartedCb: ((rec: Recording) => void) | null = null
  private onStoppedCb: ((rec: Recording) => void) | null = null

  constructor(store: RequestStore, opts: RecordingControllerOptions) {
    this.store = store
    this.proxyPort = opts.proxyPort
    this.profileDir =
      opts.profileDir ?? `${process.env.HOME}/.flowctx/chrome-profile`
    this.resetCapture = opts.resetCapture
  }

  /** S3 registers these so it can broadcast WS events on start/stop. */
  onStarted(cb: (rec: Recording) => void): void {
    this.onStartedCb = cb
  }
  onStopped(cb: (rec: Recording) => void): void {
    this.onStoppedCb = cb
  }

  getActive(): string | null {
    return this.activeId
  }

  start(): Recording {
    // Stop any in-flight recording first so there is only ever one active.
    if (this.activeId) this.stop()

    // Restart per-recording capture numbering before any traffic can arrive.
    this.resetCapture?.()

    const recording = this.store.createRecording(defaultRecordingName())
    this.activeId = recording.id
    this.child = this.spawnBrowser()

    // Browser exit => recording done. spawn (not `open`) is required so we get
    // this exit event; `open` detaches and we'd never know the window closed.
    if (this.child) {
      const launchedAt = Date.now()
      this.child.on('exit', () => {
        const lived = Date.now() - launchedAt
        this.child = null
        if (lived < INSTANT_EXIT_MS) {
          console.warn(
            `Recording browser exited after ${lived}ms — it likely failed to ` +
              `launch (e.g. Chrome handed off to an existing window using the ` +
              `recording profile). Stopping recording.`
          )
        }
        this.stop()
      })
    }

    this.onStartedCb?.(recording)
    return recording
  }

  stop(): void {
    const id = this.activeId
    if (!id) return
    this.activeId = null

    this.store.stopRecording(id)

    // Kill the browser if it's still alive (i.e. user hit Stop in the UI rather
    // than closing the window). The exit handler is a no-op now activeId is null.
    if (this.child && this.child.exitCode === null && !this.child.killed) {
      this.child.kill()
    }
    this.child = null

    const recording = this.store.getRecording(id)
    if (recording) this.onStoppedCb?.(recording)
  }

  // Chrome only ever creates a new, trackable process if no other Chrome already
  // holds our --user-data-dir; otherwise it hands the launch off to that running
  // instance and our spawned launcher exits at once. A leftover from a crashed
  // server, a previous run, or a proxy-port change (the old window keeps dialing
  // the stale port) would therefore both break exit-tracking AND route traffic to
  // the wrong proxy. The profile is exclusively ours, so terminate anything still
  // using it, then clear Chrome's singleton lock so the fresh launch owns it.
  private clearStaleProfileChrome(): void {
    try {
      // The pattern must NOT start with "-": BSD/macOS pgrep parses a leading
      // dash as an option flag ("illegal option -- -"), so drop the "--" from
      // "--user-data-dir". The profile dir is unique, so this still matches only
      // our Chrome.
      const out = execFileSync('pgrep', ['-f', `user-data-dir=${this.profileDir}`], {
        encoding: 'utf8',
      })
      for (const line of out.split('\n')) {
        const pid = Number(line.trim())
        if (pid && pid !== process.pid) {
          try {
            process.kill(pid)
          } catch {
            // already gone / not ours — ignore
          }
        }
      }
    } catch {
      // pgrep exits non-zero when nothing matches: no stale instance, nothing to do.
    }

    // Best-effort: drop the singleton lock files so a just-killed Chrome can't
    // still cause a handoff before it finishes tearing down.
    for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      try {
        rmSync(join(this.profileDir, f), { force: true })
      } catch {
        // ignore
      }
    }
  }

  private spawnBrowser(): ChildProcess | null {
    this.clearStaleProfileChrome()

    const args = [
      `--proxy-server=127.0.0.1:${this.proxyPort}`,
      // "<-loopback>" means loopback IS proxied (default bypasses it).
      '--proxy-bypass-list=<-loopback>',
      `--user-data-dir=${this.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ]

    // macOS caveat: launching via `open` detaches and Chrome may hand the URL
    // off to an existing process, so we can't track exit. Spawn the binary
    // directly (with a dedicated --user-data-dir to avoid the running default
    // profile) so the child PID is the actual browser we can watch and kill.
    if (existsSync(CHROME_BINARY)) {
      return spawn(CHROME_BINARY, args, { stdio: 'ignore' })
    }

    // Fallback if the standard binary path is missing: `open -n` forces a new
    // instance. We lose reliable exit tracking here, but the A2 gating still
    // keeps capture correct and the UI Stop button still works.
    console.warn(
      `Chrome binary not found at ${CHROME_BINARY}; falling back to "open -n" (browser-exit auto-stop may not fire).`
    )
    return spawn(
      'open',
      ['-n', '-a', 'Google Chrome', '--args', ...args],
      { stdio: 'ignore' }
    )
  }
}
