# Transmission Helm — developer shortcuts. Run `make help` for a list.
SHELL := /bin/sh
.DEFAULT_GOAL := help

NPM ?= npm

.PHONY: help install dev test test-watch lint format typecheck check build pack mac win linux daemon daemon-stop daemon-add mock clean distclean

help: ## Show this help
	@echo "Transmission Helm"
	@echo
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9_-]+:.*##/ { printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo
	@echo "Node $$(cat .nvmrc) is recommended (see .nvmrc); Electron bundles the same major version."

install: ## Install dependencies (npm ci)
	$(NPM) ci

dev: ## Run the app with hot reload
	$(NPM) run dev

test: ## Run unit tests once
	$(NPM) test

test-watch: ## Run unit tests in watch mode
	$(NPM) run test:watch

lint: ## Lint with ESLint
	$(NPM) run lint

format: ## Format sources with Prettier
	$(NPM) run format

typecheck: ## Type-check main/preload (tsc) and renderer (svelte-check)
	$(NPM) run typecheck

check: lint typecheck test ## Everything CI runs before building

build: ## Bundle main, preload and renderer into out/
	$(NPM) run build

pack: ## Unpacked app for this OS in dist/ (no installer)
	CSC_IDENTITY_AUTO_DISCOVERY=false $(NPM) run build:unpack

mac: ## macOS dmg + zip (Apple Silicon)
	$(NPM) run build:mac

win: ## Windows installer + portable exe
	$(NPM) run build:win

linux: ## Linux AppImage, deb and rpm
	$(NPM) run build:linux

daemon: ## Start a real Transmission daemon in Docker on 127.0.0.1:9091
	scripts/dev-daemon.sh

daemon-stop: ## Stop and remove the Docker daemon
	scripts/dev-daemon.sh stop

daemon-add: ## Add a torrent to the Docker daemon: make daemon-add URL="magnet:?..."
	scripts/dev-daemon.sh add "$(URL)"

mock: ## Start the in-process fake daemon on port 9099
	node scripts/mock-daemon.mjs 9099

clean: ## Remove build output
	rm -rf out dist .eslintcache

distclean: clean ## Also remove node_modules
	rm -rf node_modules
