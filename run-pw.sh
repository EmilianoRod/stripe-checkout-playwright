#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Playwright runner (headed-by-default in CI to look like a real user)
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
# Robust: try Node API, fallback to parsing `node -v`, all *inside* the command substitution.
NODE_MAJOR="$(
  (node -p 'process.versions.node.split(".")[0]' 2>/dev/null) \
  || (node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/') \
  || echo 0
)"
# Ensure it's numeric
if ! [[ "$NODE_MAJOR" =~ ^[0-9]+$ ]]; then NODE_MAJOR=0; fi
echo "[PW] Node major: ${NODE_MAJOR} (need >= ${REQUIRED_NODE_MAJOR})"
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  echo "[PW] ERROR: Node >= ${REQUIRED_NODE_MAJOR} required. Found: $(node -v 2>/dev/null || echo none)"
  exit 2
fi

# ---- Ensure dependencies & browsers (skip with PW_SKIP_INSTALL=1) ----
if [ "${PW_SKIP_INSTALL:-0}" != "1" ]; then
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

  if [ -x ./node_modules/.bin/playwright ]; then
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

# ---- Defaults to look like a real user ----
PW_SLOWMO="${PW_SLOWMO:-25}"                # read by config (do NOT pass on CLI)
PW_CHANNEL="${PW_CHANNEL:-chrome}"          # prefer consumer Chrome build

# Normalize PW_HEADLESS env to true/false (default headed)
_headless_raw="${PW_HEADLESS:-false}"
case "$(printf '%s' "$_headless_raw" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes)      PW_HEADLESS="true"  ;;
  0|false|no|'')   PW_HEADLESS="false" ;;
  *)               PW_HEADLESS="false" ;;
esac

# Align OS TZ with us-east-2 (helps reduce geo/time mismatch signals)
export TZ="${TZ:-America/New_York}"

# Export so playwright.config.ts can read them
export PW_SLOWMO PW_HEADLESS PW_CHANNEL TZ

# ---- Extra CLI flags from env ----
EXTRA_ARGS=()

is_help_supported_channel() {
  ./node_modules/.bin/playwright test -h 2>&1 | grep -q -- '--channel'
}

if [ "${1:-}" = "test" ]; then
  [ -n "${PW_RETRIES:-}" ]    && EXTRA_ARGS+=( "--retries=${PW_RETRIES}" )
  [ -n "${PW_TIMEOUT_MS:-}" ] && EXTRA_ARGS+=( "--timeout=${PW_TIMEOUT_MS}" )

  if [ -n "${PW_CHANNEL}" ] && is_help_supported_channel; then
    EXTRA_ARGS+=( "--channel=${PW_CHANNEL}" )
  elif [ -n "${PW_CHANNEL}" ]; then
    echo "[PW] note: --channel unsupported by this Playwright; ignoring PW_CHANNEL=${PW_CHANNEL}"
  fi

  if [ "${PW_HEADLESS}" = "false" ]; then
    EXTRA_ARGS+=( "--headed" )
  fi
  # NOTE: no --slow-mo; handled in config
else
  if [ -n "${PW_CHANNEL}" ] && ./node_modules/.bin/playwright -h 2>&1 | grep -q -- '--channel'; then
    EXTRA_ARGS+=( "--channel=${PW_CHANNEL}" )
  fi
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

echo "[PW] Command: ${run_cmd[*]}"
if $use_xvfb; then
  echo "[PW] Using Xvfb (headed in CI)"
  exec xvfb-run -a -s "-screen 0 1920x1080x24" "${run_cmd[@]}"
else
  exec "${run_cmd[@]}"
fi
