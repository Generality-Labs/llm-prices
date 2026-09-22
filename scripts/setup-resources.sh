#!/usr/bin/env bash
# Create the Cloudflare resources wrangler.toml can only *reference* — one
# idempotent command per environment, safe to re-run after a partial failure.
#
# wrangler.toml declares bindings; it does not create queues, DLQs, R2 event
# notifications, or lifecycle rules, and does not apply CORS. Add a try/run
# line per resource this Worker needs, and keep the printed follow-ups
# current. Give every queue consumer a dead-letter queue: without one,
# exhausted retries DELETE the message and a real failure looks like nothing
# happened — and the DLQ must exist before the consumer Worker deploys.
#
# Usage:
#   scripts/setup-resources.sh <staging|production>
set -euo pipefail

env="${1:-}"
case "$env" in
  staging | production) ;;
  *)
    echo "usage: $0 <staging|production>" >&2
    exit 1
    ;;
esac

# Bind every resource name for this environment in one place so the commands
# and the printed next-steps can never disagree about their target. Check
# names against wrangler.toml rather than assuming one suffix convention.
case "$env" in
  staging)
    # bucket="my-worker-staging"
    ;;
  production)
    # bucket="my-worker"
    ;;
esac

# Run a create-style command, tolerating "already exists" (so re-runs are
# safe) but aborting loudly on anything else — auth, scope, network. The
# pattern is a moving target across wrangler versions: 4.x reports an
# existing queue as "already taken" (code 11009); `lifecycle add` reports a
# duplicate rule with "must be unique".
# shellcheck disable=SC2329  # invoked once real resource lines are added
try() {
  local out
  echo "+ $*"
  if out="$("$@" 2>&1)"; then
    printf '%s\n' "$out"
  elif grep -qiE 'already (exists|created|taken)|already a (queue|rule)|must be unique|conflict' <<< "$out"; then
    echo "  (already exists — skipping)"
  else
    printf '%s\n' "$out" >&2
    exit 1
  fi
}

# For genuinely idempotent commands (e.g. `r2 bucket cors set`) that safely
# overwrite on re-run.
# shellcheck disable=SC2329  # invoked once real resource lines are added
run() {
  echo "+ $*"
  "$@"
}

# --- resource creation -------------------------------------------------------
# Examples — delete what this Worker doesn't use:
#
#   try npx wrangler queues create "$queue"
#   try npx wrangler queues create "$dlq"    # DLQs are never auto-created
#   run npx wrangler r2 bucket cors set "$bucket" --file "cors.$env.json"
#
# CAREFUL: `wrangler r2 bucket notification create` is NOT idempotent — every
# run adds a duplicate rule (double event delivery). List first and grep:
#
#   if ! npx wrangler r2 bucket notification list "$bucket" | grep -q "$queue"; then
#     run npx wrangler r2 bucket notification create "$bucket" \
#       --event-type object-create --queue "$queue"
#   fi

echo "done: $env resources are in place."

cat << EOF

Remaining steps this script can't do:
  - secrets: scripts/put-secrets.sh $env
  - GitHub environment variables (HEALTH_URL) and secrets (see README)
  - anything dashboard-only — list it here as you find it
EOF
