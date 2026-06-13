#!/usr/bin/env bash
set -e

# MANUAL FALLBACK. The PRIMARY path is now the UI "Start Recording" button,
# which spawns this same proxied Chrome from the server and auto-stops capture
# when the browser closes (see src/proxy/lifecycle.ts). This script remains as a
# manual escape hatch.
#
# NOTE: capture is gated on an ACTIVE recording. Launching Chrome here alone does
# NOT capture anything unless a recording is active (start one from the UI).
#
# Opens a fresh, isolated Chrome instance with the recorder proxy preconfigured.
# Assumes `make start` is already running (proxy + UI server). Browse in this
# window and traffic is captured; it opens to about:blank so you navigate to
# whatever you want to record.

# Load .env if present and not already exported (e.g. when run directly, not via
# `make record`), so the proxy port matches start/stop. Default stays off 8080.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

PROXY_PORT="${PROXY_PORT:-8081}"
PROFILE_DIR="$HOME/.flowctx/chrome-profile"

# -n forces a new Chrome instance so the proxy args are honored even if Chrome
# is already running with the default profile.
open -n -a "Google Chrome" --args \
  --proxy-server="127.0.0.1:${PROXY_PORT}" \
  --proxy-bypass-list="<-loopback>" \
  --user-data-dir="${PROFILE_DIR}" \
  --no-first-run \
  --no-default-browser-check \
  about:blank

echo "Recording Chrome launched (proxy 127.0.0.1:${PROXY_PORT}). Browse to capture requests."
