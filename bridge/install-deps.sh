#!/usr/bin/env bash
# Install bridge Python deps with the same release-age gate as root .npmrc.
set -euo pipefail
cd "$(dirname "$0")"

ROOT="$(cd .. && pwd)"
AGE_DAYS=10
if [[ -f "$ROOT/.npmrc" ]]; then
  from_npmrc="$(grep -E '^[[:space:]]*min-release-age=' "$ROOT/.npmrc" | head -1 | cut -d= -f2 | tr -d '[:space:]')"
  if [[ -n "${from_npmrc:-}" && "$from_npmrc" =~ ^[0-9]+$ ]]; then
    AGE_DAYS="$from_npmrc"
  fi
fi

# pip 25+ accepts ISO-8601 durations (P10D = at least 10 days old), like npm min-release-age.
PRIOR_TO="P${AGE_DAYS}D"

pip_has_age_gate() {
  python3 -m pip install --help 2>/dev/null | grep -q -- '--uploaded-prior-to'
}

if ! pip_has_age_gate; then
  echo "[bridge] pip lacks --uploaded-prior-to; upgrading pip…"
  python3 -m pip install --user -U pip
fi

if ! pip_has_age_gate; then
  echo "[bridge] error: pip still has no --uploaded-prior-to after upgrade."
  echo "[bridge] Install a newer pip, then retry: python3 -m pip install --user -U 'pip>=25'"
  exit 1
fi

echo "[bridge] pip install (--uploaded-prior-to ${PRIOR_TO}; min-release-age=${AGE_DAYS}d from .npmrc)"
python3 -m pip install --user \
  --uploaded-prior-to "$PRIOR_TO" \
  -r requirements.txt
