#!/usr/bin/env bash
set -euo pipefail

# ---- Select Node (Volta > nvm > system) ----
if command -v volta >/dev/null 2>&1; then
  echo "[PW] Using Volta-managed Node"
elif [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm install >/dev/null    # respects .nvmrc (Node 22)
  nvm use >/dev/null
else
  echo "[PW] WARN: Neither Volta nor nvm found. Falling back to system Node."
fi

# Work from this script's directory (repo root for PW)
cd "$(dirname "$0")"

echo "[PW] node version: $(node -v 2>/dev/null || echo 'not found')"
echo "[PW] npm version : $(npm -v 2>/dev/null || echo 'not found')"

# ---- Early runtime guards ----
REQUIRED_NODE_MAJOR=18
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  echo "[PW] ERROR: Node >= ${REQUIRED_NODE_MAJOR} required. Found: $(node -v 2>/dev/null || echo none)"
  exit 2
fi

# ---- Ensure dependencies & browsers (skip with PW_SKIP_INSTALL=1) ----
if [ "${PW_SKIP_INSTALL:-0}" != "1" ]; then
  # Prefer npm ci, but fall back if lockfile is missing/old
  if [ -f package-lock.json ]; then
    echo "[PW] Installing node modules (npm ci)…"
    if ! npm ci; then
      echo "[PW] npm ci failed; falling back to 'npm install'…"
      npm install
    fi
  else
    echo "[PW] No package-lock.json; using 'npm install'…"
    npm install
  fi

  # Use the project's local Playwright CLI (avoid npx global drift)
  if [ -x ./node_modules/.bin/playwright ]; then
    # Install browsers; add --with-deps only when we're root and apt-get exists
    if command -v apt-get >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then
      echo "[PW] Installing Playwright browsers (+deps)…"
      ./node_modules/.bin/playwright install --with-deps || ./node_modules/.bin/playwright install
    else
      echo "[PW] Installing Playwright browsers…"
      ./node_modules/.bin/playwright install
    fi
  else
    echo "[PW] ERROR: Playwright CLI not found after npm install."
    echo "[PW] Hint: ensure devDependencies includes '@playwright/test' or 'playwright'."
    exit 1
  fi
fi

# ---- Extra CLI flags from env ----
EXTRA_ARGS=()
if [ "${1:-}" = "test" ]; then
  # Fail fast unless explicitly overridden
  [ -n "${PW_RETRIES:-}" ]    && EXTRA_ARGS+=( "--retries=${PW_RETRIES}" )
  # Optional per-test timeout in ms
  [ -n "${PW_TIMEOUT_MS:-}" ] && EXTRA_ARGS+=( "--timeout=${PW_TIMEOUT_MS}" )

  # Add --channel only if supported by this PW version
  if [ -n "${PW_CHANNEL:-}" ] && ./node_modules/.bin/playwright test -h 2>&1 | grep -q -- '--channel'; then
    EXTRA_ARGS+=( "--channel=${PW_CHANNEL}" )
  elif [ -n "${PW_CHANNEL:-}" ]; then
    echo "[PW] note: --channel unsupported by this Playwright; ignoring PW_CHANNEL=${PW_CHANNEL}"
  fi
else
  # Non-test commands can still use channel if supported
  if [ -n "${PW_CHANNEL:-}" ] && ./node_modules/.bin/playwright -h 2>&1 | grep -q -- '--channel'; then
    EXTRA_ARGS+=( "--channel=${PW_CHANNEL}" )
  fi
fi

# ---- Run using the local CLI ----
if [ -x node_modules/.bin/playwright ]; then
  exec ./node_modules/.bin/playwright "$@" "${EXTRA_ARGS[@]}"
else
  echo "[PW] ERROR: Playwright CLI not found at node_modules/.bin/playwright"
  echo "[PW] Hint: add '@playwright/test' (or 'playwright') to devDependencies and run: npm ci"
  exit 1
fi
