#!/usr/bin/env bash
set -e

# Stops the dev processes started by `make start` (npm run dev):
#   - the MITM proxy + app server (one tsx-watch node process)
#   - the vite UI dev server
# Killed by the ports they own so we don't have to track PIDs. Ports come from
# .env (the same source start uses), so we only ever touch the recorder's own
# ports — never a stray 8080 that something else (e.g. Zookeeper) may hold.

# Load .env if present and not already exported (e.g. when run directly, not via
# `make stop`). Values are simple KEY=VALUE with no spaces.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

PROXY_PORT="${PROXY_PORT:-8081}"
UI_PORT="${UI_PORT:-3000}"
VITE_PORT="${VITE_PORT:-5173}"

stopped=0
for port in "$PROXY_PORT" "$UI_PORT" "$VITE_PORT"; do
  # -t: terse, PIDs only. May list several (e.g. ipv4+ipv6 listeners).
  pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    echo "Stopped process on :${port} (pid ${pids//$'\n'/ })"
    stopped=1
  fi
done

if [ "$stopped" -eq 0 ]; then
  echo "Nothing to stop (no process on :${PROXY_PORT}, :${UI_PORT}, :${VITE_PORT})."
fi
