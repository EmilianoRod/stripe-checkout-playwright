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

echo "[PW] node version: $(node -v)"
echo "[PW] npm version : $(npm -v)"

# ---- Ensure dependencies & browsers (skip with PW_SKIP_INSTALL=1) ----
if [ "${PW_SKIP_INSTALL:-0}" != "1" ]; then
  if [ ! -d node_modules ] || [ ! -x node_modules/.bin/playwright ]; then
    echo "[PW] Installing node modules (npm ci)…"
    npm ci
  fi

  if ! ./node_modules/.bin/playwright --version >/dev/null 2>&1; then
    echo "[PW] Installing Playwright browsers…"
    npx playwright install --with-deps
  fi
fi

# ---- Extra CLI flags from env ----
# ---- Extra CLI flags from env ----
EXTRA_ARGS=()
if [ "${1:-}" = "test" ]; then
  # Fail fast unless explicitly overridden
  [ -n "${PW_RETRIES:-}" ]   && EXTRA_ARGS+=( "--retries=${PW_RETRIES}" )
  # Optional per-test timeout in ms
  [ -n "${PW_TIMEOUT_MS:-}" ] && EXTRA_ARGS+=( "--timeout=${PW_TIMEOUT_MS}" )

  # Only add --channel if this Playwright version supports it (older CI won't)
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
