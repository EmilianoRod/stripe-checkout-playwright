#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Playwright runner (headed-by-default; prefers real Google Chrome)
# Anti-bot hygiene: real Chrome, coherent locale/TZ/UA, headed, slowMo a bit
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
  (node -p 'process.versions.node.split(\".\")[0]' 2>/dev/null) \
  || (node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/') \
  || echo 0
)"
[[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || NODE_MAJOR=0
echo "[PW] Node major: ${NODE_MAJOR} (need >= ${REQUIRED_NODE_MAJOR})"
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ]; then
  echo "[PW] ERROR: Node >= ${REQUIRED_NODE_MAJOR} required. Found: $(node -v 2>/dev/null || echo none)"
  exit 2
fi

# ---- Caching & install knobs ----
# Cache Playwright browsers between runs (keeps the exact versions PW wants)
# Local default goes to a user-writable cache; CI can override to a shared path.
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  if [ "${CI:-}" = "1" ]; then
    export PLAYWRIGHT_BROWSERS_PATH="/root/.cache/ms-playwright"
  else
    export PLAYWRIGHT_BROWSERS_PATH="${HOME}/.cache/ms-playwright"
  fi
fi

# Optionally skip installs (e.g., on a pre-baked container)
PW_SKIP_INSTALL="${PW_SKIP_INSTALL:-0}"

# Which browsers to install? Default to chromium-only (avoids macOS 12 WebKit).
# Set PW_INSTALL_BROWSERS=all if you want everything (chromium firefox webkit).
PW_INSTALL_BROWSERS="${PW_INSTALL_BROWSERS:-chromium}"

# ---- Ensure dependencies & browsers ----
if [ "$PW_SKIP_INSTALL" != "1" ]; then
  if [ -f package-lock.json ]; then
    echo "[PW] Installing node modules (npm ci --ignore-scripts)…"
    npm ci --ignore-scripts --prefer-offline --no-audit --fund=false \
      || (echo "[PW] npm ci failed; falling back to 'npm install --ignore-scripts'…" \
      && npm install --ignore-scripts --no-audit --fund=false)
  else
    echo "[PW] No package-lock.json; using 'npm install --ignore-scripts'…"
    npm install --ignore-scripts --no-audit --fund=false
  fi

  if [ -x ./node_modules/.bin/playwright ]; then
    # Decide set to install (we’ll add ffmpeg below if needed)
    if [ "${PW_INSTALL_BROWSERS}" = "all" ]; then
      INSTALL_SET=(chromium firefox webkit)
    else
      INSTALL_SET=(chromium)
    fi

    # If cache already has chromium, skip reinstall to save time.
    have_chromium="$(ls -d "${PLAYWRIGHT_BROWSERS_PATH}"/chromium-* 2>/dev/null | head -n1 || true)"
    if [ -n "${have_chromium}" ]; then
      echo "[PW] Reusing cached Chromium at: ${have_chromium}"
      # Properly filter the array WITHOUT leaving empty elements
      declare -a filtered=()
      for b in "${INSTALL_SET[@]}"; do
        if [ "$b" != "chromium" ] && [ -n "$b" ]; then
          filtered+=("$b")
        fi
      done
      # macOS Bash 3.2: guard empty array under `set -u`
      if [ "${#filtered[@]:-0}" -gt 0 ]; then
        INSTALL_SET=("${filtered[@]}")
      else
        INSTALL_SET=()
      fi
    fi

    # --- ensure ffmpeg is present (needed for video/trace on macOS too) ---
    have_ffmpeg="$(ls -d "${PLAYWRIGHT_BROWSERS_PATH}"/ffmpeg_* 2>/dev/null | head -n1 || true)"
    if [ -z "${have_ffmpeg}" ]; then
      echo "[PW] Playwright ffmpeg not found in cache — will install ffmpeg"
      INSTALL_SET+=("ffmpeg")
    fi
    # ---------------------------------------------------------------------

    # Linux root/CI → allow --with-deps; elsewhere, plain install to avoid EACCES/frozen webkit
    if command -v apt-get >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then
      if [ "${#INSTALL_SET[@]}" -gt 0 ]; then
        echo "[PW] Installing Playwright browsers (+deps): ${INSTALL_SET[*]} …"
        ./node_modules/.bin/playwright install --with-deps "${INSTALL_SET[@]}" \
          || ./node_modules/.bin/playwright install "${INSTALL_SET[@]}"
      else
        echo "[PW] All required components present in cache."
      fi
    else
      if [ "${#INSTALL_SET[@]}" -gt 0 ]; then
        echo "[PW] Installing Playwright components: ${INSTALL_SET[*]} …"
        ./node_modules/.bin/playwright install "${INSTALL_SET[@]}"
      else
        echo "[PW] All required components present in cache."
      fi
    fi

    # Optional OS deps bootstrap: only when explicitly requested
    if command -v apt-get >/dev/null 2>&1 && [ "$(id -u)" = "0" ]; then
      if [ "${PW_BOOTSTRAP_DEPS:-0}" = "1" ]; then
        echo "[PW] Installing system deps for PW (bootstrap)…"
        ./node_modules/.bin/playwright install-deps || true
      fi
    fi
  else
    echo "[PW] ERROR: Playwright CLI not found after npm install."
    echo "[PW] Hint: ensure devDependencies includes '@playwright/test'."
    exit 1
  fi
fi

# ---- Defaults that look like a real user (read by playwright.config.ts) ----
export PW_CHANNEL="${PW_CHANNEL:-chrome}"        # config uses it; we don't pass --channel here
export PW_SLOWMO="${PW_SLOWMO:-10}"              # tiny human-ish pacing in CI helps
# Headed by default unless explicitly forced off
_headless_raw="${PW_HEADLESS:-false}"
case "$(printf '%s' "$_headless_raw" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes)  export PW_HEADLESS="true"  ;;
  0|false|no|'') export PW_HEADLESS="false" ;;
  *)           export PW_HEADLESS="false" ;;
esac

# Locale / timezone / language / UA ⇒ coherent browser profile
export PW_LOCALE="${PW_LOCALE:-en-US}"
export PW_TZ="${PW_TZ:-America/New_York}"
export TZ="${TZ:-$PW_TZ}"
export PW_ACCEPT_LANGUAGE="${PW_ACCEPT_LANGUAGE:-${PW_LOCALE},en;q=0.9}"
export PW_UA="${PW_UA:-Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36}"

# Optional: reseed storage state on demand (else reuse)
export PW_RESEED_STATE="${PW_RESEED_STATE:-0}"

# ---- Auto-detect Chrome and export CHROME_PATH (used by config) ----
if [ -z "${CHROME_PATH:-}" ]; then
  # macOS
  mac_chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if [ -x "$mac_chrome" ]; then
    export CHROME_PATH="$mac_chrome"
  elif command -v google-chrome-stable >/dev/null 2>&1; then
    export CHROME_PATH="$(command -v google-chrome-stable)"
  elif command -v google-chrome >/dev/null 2>&1; then
    export CHROME_PATH="$(command -v google-chrome)"
  elif command -v chromium >/dev/null 2>&1; then
    export CHROME_PATH="$(command -v chromium)"  # fallback if Chrome not present
  fi
fi

# Print Chrome version if we have a path
if [ -n "${CHROME_PATH:-}" ] && [ -x "${CHROME_PATH}" ]; then
  echo "[PW] Chrome binary: ${CHROME_PATH}"
  "${CHROME_PATH}" --version || true
else
  echo "[PW] Chrome binary not detected via CHROME_PATH; relying on Playwright channel='${PW_CHANNEL}'."
fi

# Export so playwright.config.ts & global-setup.ts can read them
export PW_CHANNEL PW_SLOWMO PW_HEADLESS CHROME_PATH

# ---- Extra CLI flags (keep minimal; config handles most) ----
EXTRA_ARGS=()
if [ "${1:-}" = "test" ]; then
  [ -n "${PW_RETRIES:-}" ]    && EXTRA_ARGS+=( "--retries=${PW_RETRIES}" )
  [ -n "${PW_TIMEOUT_MS:-}" ] && EXTRA_ARGS+=( "--timeout=${PW_TIMEOUT_MS}" )
  # Do NOT pass --channel/--headed here; config reads env and decides.
fi

# ---- Decide how to launch (Xvfb on Linux when headed & no DISPLAY) ----
BIN="./node_modules/.bin/playwright"
run_cmd=("$BIN" "$@" "${EXTRA_ARGS[@]}")

use_xvfb=false
if [ "${1:-}" = "test" ] && [ "${PW_HEADLESS}" = "false" ]; then
  if command -v xvfb-run >/dev/null 2>&1 && [ -z "${DISPLAY:-}" ]; then
    use_xvfb=true
  fi
fi

# ---- Friendly env echo ----
echo "[PW] env: CI=${CI:-}, PW_HEADLESS=${PW_HEADLESS}, PW_CHANNEL=${PW_CHANNEL}, PW_SLOWMO=${PW_SLOWMO}"
echo "[PW] locale=${PW_LOCALE}, tz=${PW_TZ}, accept-language='${PW_ACCEPT_LANGUAGE}'"
echo "[PW] user-agent='${PW_UA}'"
echo "[PW] CHECKOUT_URL=${CHECKOUT_URL:-<unset>}"
echo "[PW] PW_STORAGE_STATE=${PW_STORAGE_STATE:-<unset>} $( [ -n "${PW_STORAGE_STATE:-}" ] && [ -f "${PW_STORAGE_STATE}" ] && echo '[exists]' || true )"
echo "[PW] CHROME_PATH=${CHROME_PATH:-<unset>}"
echo "[PW] PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH}"
echo "[PW] PW_INSTALL_BROWSERS=${PW_INSTALL_BROWSERS}"

echo "[PW] Command: ${run_cmd[*]}"
if $use_xvfb; then
  echo "[PW] Using Xvfb (headed in CI)"
  exec xvfb-run -a -s "-screen 0 1920x1080x24" "${run_cmd[@]}"
else
  exec "${run_cmd[@]}"
fi
