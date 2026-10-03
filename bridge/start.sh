#!/usr/bin/env bash
# Start the BLEnum BLE bridge (Python/bleak preferred on macOS).
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[bridge] python3 not found. Install Python 3, then retry."
  exit 1
fi

if ! python3 -c "import bleak, websockets" 2>/dev/null; then
  echo "[bridge] Installing Python deps (bleak, websockets)…"
  python3 -m pip install --user -r requirements.txt
fi

exec env PYTHONUNBUFFERED=1 python3 server.py
