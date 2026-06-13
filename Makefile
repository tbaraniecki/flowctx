.PHONY: setup install start stop record help

# Load ports from .env (if present) so start, stop and the UI dev server all
# agree on which ports to use. Defaults match .env.example and cover the case
# where .env hasn't been created yet. PROXY_PORT stays off 8080 (Zookeeper).
-include .env
PROXY_PORT ?= 8081
UI_PORT ?= 3000
VITE_PORT ?= 5173
export PROXY_PORT UI_PORT VITE_PORT

help:
	@echo "Usage:"
	@echo "  make install    # install npm dependencies"
	@echo "  make setup      # install deps + trust mitmproxy cert"
	@echo "  make start      # start proxy + UI server, open UI in Chrome (unproxied)"
	@echo "  make stop       # stop the proxy + UI server and vite dev server"
	@echo "  make record     # open a proxied Chrome (new profile) to capture traffic"

install:
	npm install

setup: install
	npx tsx src/proxy/cert.ts

start:
	OPEN_URL=http://localhost:$(VITE_PORT) npm run dev

stop:
	bash scripts/stop.sh

record:
	bash scripts/record.sh
