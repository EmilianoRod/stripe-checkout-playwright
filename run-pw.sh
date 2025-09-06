
#!/usr/bin/env bash

set -euo pipefail

# Prefer Volta if present; else use nvm + .nvmrc (Node 22)
if command -v volta >/dev/null 2>&1; then
  echo "[PW] Using Volta-managed Node"
elif [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
  nvm install >/dev/null    # reads .nvmrc (22)
  nvm use >/dev/null
else
  echo "[PW] WARN: Neither Volta nor nvm found. Falling back to system Node."
fi

cd "$(dirname "$0")"
echo "[PW] node version: $(node -v)"
echo "[PW] npm version : $(npm -v)"
