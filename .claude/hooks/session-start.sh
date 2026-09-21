#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Install dependencies (wrangler, vitest, tsc) so tests and type-checks work
# immediately.
npm ci

# Best-effort pre-commit warm-up: install the git hook and pre-build hook
# environments so the first commit isn't slow. Pre-existing findings shouldn't
# block session start - failures surface as normal output for the agent to see
# and address, not a broken session.
if command -v uv >/dev/null 2>&1; then
  uv tool install --quiet pre-commit || true
  pre-commit install || true
  pre-commit run --all-files || true
fi
