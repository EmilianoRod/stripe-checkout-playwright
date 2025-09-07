#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Playwright runner (headed-by-default; prefers real Google Chrome)
# ==============================================================================

# ---- Select Node (Volta > nvm > system) ----
if command -v volta >/dev/null 2>&1; then
  echo "[PW] Using Volta-managed Node"
elif [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm install >/dev/null    # respects .nvmrc
  nvm use >/dev/null
else
  echo "[PW] WARN: Neither Volta nor nvm found. Falling back to system Node."
fi

# Work from this script's directory (repo root for PW)
cd "$(dirname "$0")"

echo "[PW] node version: $(node -v 2>/dev/null || echo 'not found')"
echo "[PW] npm  version: $(npm -v 2>/dev/null || echo 'not found')"

# ---- Early runtime guards ----
REQUIRED_NODE_MAJOR=18
NODE_MAJOR="$(
  (node -p 'process.versions.node.split(".")[0]' 2>/dev/null) \
  || (node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/') \
  || echo 0
)"
[[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || NODE_MAJOR=0
echo "[PW] Node major: ${NODE_MAJOR} (need >= ${REQUIRED_NODE_MAJOR})"
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  echo "[PW] ERROR: Node >= ${REQUIRED_NODE_MAJOR} required. Found: $(node -v 2>/dev/null || echo none)"
  exit 2
fi

# ---- Ensure dependencies & browsers (skip with PW_SKIP_INSTALL=1) ----
if [ "${PW_SKIP_INSTALL:-0}" != "1" ]; then
  if [ -f package-lock.json ]; then
    echo "[PW] Installing node modules (npm ci)…"
    npm ci || (echo "[PW] npm ci failed; falling back to 'npm install'…" && npm install)
  else
    echo "[PW] No package-lock.json; using 'npm install'…"
    npm install
  fi

  if [ -x ./node_modules/.bin/playwright ]; then
    # Install Playwright browsers & OS deps (safe even if using real Chrome)
    if command -v apt-get >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then
      echo "[PW] Installing Playwright browsers (+deps)…"
      ./node_modules/.bin/playwright install --with-deps || ./node_modules/.bin/playwright install
    else
      echo "[PW] Installing Playwright browsers…"
      ./node_modules/.bin/playwright install
    fi
  else
    echo "[PW] ERROR: Playwright CLI not found after npm install."
    echo "[PW] Hint: ensure devDependencies includes '@playwright/test'."
    exit 1
  fi
fi

# ---- Defaults that look like a real user (read by playwright.config.ts) ----
PW_SLOWMO="${PW_SLOWMO:-25}"
PW_CHANNEL="${PW_CHANNEL:-chrome}"     # used by config; we won't pass --channel on CLI

# Normalize PW_HEADLESS env to "true"/"false" (default: headed)
_headless_raw="${PW_HEADLESS:-false}"
case "$(printf '%s' "$_headless_raw" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes)      PW_HEADLESS="true"  ;;
  0|false|no|'')   PW_HEADLESS="false" ;;
  *)               PW_HEADLESS="false" ;;
esac

# Align OS TZ (helps reduce geo/time mismatch signals)
export TZ="${TZ:-America/New_York}"

# ---- Auto-detect Chrome and export CHROME_PATH for the config (optional) ----
if [ -z "${CHROME_PATH:-}" ]; then
  # macOS default install
  mac_chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if [ -x "$mac_chrome" ]; then
    export CHROME_PATH="$mac_chrome"
  elif command -v google-chrome-stable >/dev/null 2>&1; then
    export CHROME_PATH="$(command -v google-chrome-stable)"
  elif command -v google-chrome >/dev/null 2>&1; then
    export CHROME_PATH="$(command -v google-chrome)"
  elif command -v chromium >/dev/null 2>&1; then
    # Not ideal for fingerprinting, but better than nothing
    export CHROME_PATH="$(command -v chromium)"
  fi
fi

# Print Chrome version if we have a path
if [ -n "${CHROME_PATH:-}" ] && [ -x "${CHROME_PATH}" ]; then
  echo "[PW] Chrome binary: ${CHROME_PATH}"
  "${CHROME_PATH}" --version || true
else
  echo "[PW] Chrome binary not detected via CHROME_PATH; relying on Playwright channel='${PW_CHANNEL}'."
fi

# Export so playwright.config.ts can read them
export PW_SLOWMO PW_HEADLESS PW_CHANNEL CHROME_PATH TZ

# ---- Extra CLI flags (keep minimal; config handles most) ----
EXTRA_ARGS=()
if [ "${1:-}" = "test" ]; then
  [ -n "${PW_RETRIES:-}" ]    && EXTRA_ARGS+=( "--retries=${PW_RETRIES}" )
  [ -n "${PW_TIMEOUT_MS:-}" ] && EXTRA_ARGS+=( "--timeout=${PW_TIMEOUT_MS}" )
  # DO NOT pass --channel or --headed here; the config reads env and decides.
fi

# ---- Decide how to launch (Xvfb on Linux when headed) ----
BIN="./node_modules/.bin/playwright"
run_cmd=("$BIN" "$@" "${EXTRA_ARGS[@]}")

use_xvfb=false
if [ "${1:-}" = "test" ] && [ "${PW_HEADLESS}" = "false" ]; then
  if command -v xvfb-run >/dev/null 2>&1 && [ -z "${DISPLAY:-}" ]; then
    use_xvfb=true
  fi
fi

echo "[PW] env: CI=${CI:-}, PW_HEADLESS=${PW_HEADLESS}, PW_CHANNEL=${PW_CHANNEL}, PW_SLOWMO=${PW_SLOWMO}"
echo "[PW] CHECKOUT_URL=${CHECKOUT_URL:-<unset>}"
echo "[PW] PW_STORAGE_STATE=${PW_STORAGE_STATE:-<unset>} $( [ -n "${PW_STORAGE_STATE:-}" ] && [ -f "${PW_STORAGE_STATE}" ] && echo '[exists]' || true )"
echo "[PW] CHROME_PATH=${CHROME_PATH:-<unset>}"

echo "[PW] Command: ${run_cmd[*]}"
if $use_xvfb; then
  echo "[PW] Using Xvfb (headed in CI)"
  exec xvfb-run -a -s "-screen 0 1920x1080x24" "${run_cmd[@]}"
else
  exec "${run_cmd[@]}"
fi
