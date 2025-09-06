#!/usr/bin/env bash
set -euo pipefail

# --- Extra CLI flags from env ---
EXTRA_ARGS=()
if [ "${1:-}" = "test" ] && [ -n "${PW_TIMEOUT_MS:-}" ]; then
  EXTRA_ARGS+=( "--timeout=${PW_TIMEOUT_MS}" )
fi



# --- Select Node (Volta first, then nvm with .nvmrc=22) ---
if command -v volta >/dev/null 2>&1; then
  echo "[PW] Using Volta-managed Node"
elif [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"cd automation/playwright

  nvm install >/dev/null      # reads .nvmrc (22)
  nvm use >/dev/null
else
  echo "[PW] WARN: Neither Volta nor nvm found. Falling back to system Node."
fi

cd "$(dirname "$0")"
echo "[PW] node version: $(node -v)"
echo "[PW] npm version : $(npm -v)"

# --- Ensure dependencies & browsers (skip with PW_SKIP_INSTALL=1) ---
if [ "${PW_SKIP_INSTALL:-0}" != "1" ]; then
  if [ ! -d node_modules ]; then
    echo "[PW] Installing node modules (npm ci)…"
    npm ci
  elif [ ! -x node_modules/.bin/playwright ]; then
    echo "[PW] Playwright CLI missing; reinstalling deps (npm ci)…"
    npm ci
  fi

  # Install Playwright browsers/runtime if needed
  if ! ./node_modules/.bin/playwright --version >/dev/null 2>&1; then
    echo "[PW] Installing Playwright browsers…"
    npx playwright install --with-deps
  fi
fi


# --- Run using the local CLI ---
if [ -x node_modules/.bin/playwright ]; then
  exec ./node_modules/.bin/playwright "$@" "${EXTRA_ARGS[@]}"
else
 echo "[PW] ERROR: Playwright CLI not found at node_modules/.bin/playwright"
  echo "[PW] Hint: ensure devDependencies contains \"playwright\" or \"@playwright/test\", then run: npm ci"
  exit 1
fi


