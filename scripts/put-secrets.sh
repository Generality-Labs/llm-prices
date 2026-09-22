#!/usr/bin/env bash
# Push this Worker's secrets to a deployed environment via `wrangler secret put`.
#
# Usage:
#   scripts/put-secrets.sh <staging|production> [env-file]
#
# Secret NAMES come from .dev.vars.example (every `KEY=` line; a trailing
# "# optional" comment marks a secret that is pushed only when present).
# VALUES come from the env file (default: .dev.vars.<env>). Every required
# value is validated before anything is pushed, so a typo can't leave the
# Worker half-updated.
#
# Local dev never needs this script: `wrangler dev` and vitest read .dev.vars
# directly.
set -euo pipefail

EXAMPLE_FILE=".dev.vars.example"

env="${1:-}"
case "$env" in
  staging | production) ;;
  *)
    echo "usage: $0 <staging|production> [env-file]" >&2
    exit 1
    ;;
esac

file="${2:-.dev.vars.$env}"
if [[ ! -f "$file" ]]; then
  echo "error: $file not found." >&2
  echo "hint: cp $EXAMPLE_FILE $file  # then fill in the $env values" >&2
  exit 1
fi

REQUIRED_SECRETS=()
OPTIONAL_SECRETS=()
while IFS= read -r line; do
  name="${line%%=*}"
  if [[ "$line" == *"# optional"* ]]; then
    OPTIONAL_SECRETS+=("$name")
  else
    REQUIRED_SECRETS+=("$name")
  fi
done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$EXAMPLE_FILE" || true)

if [[ ${#REQUIRED_SECRETS[@]} -eq 0 && ${#OPTIONAL_SECRETS[@]} -eq 0 ]]; then
  echo "error: no secrets declared in $EXAMPLE_FILE — add KEY= lines first." >&2
  exit 1
fi

# Last assignment wins, like wrangler's own .dev.vars parsing. Values may be
# wrapped in single or double quotes; a matching pair is stripped. Trailing
# "# ..." comments are stripped too (put real '#' characters inside quotes).
read_value() {
  local line value
  line="$(grep -E "^${1}=" "$file" | tail -n 1 || true)"
  value="${line#*=}"
  value="${value%%#*}"
  value="$(printf '%s' "$value" | sed -e 's/[[:space:]]*$//')"
  if [[ $value == \"*\" || $value == \'*\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

missing=0
for name in ${REQUIRED_SECRETS[@]+"${REQUIRED_SECRETS[@]}"}; do
  if [[ -z "$(read_value "$name")" ]]; then
    echo "error: $name is missing or empty in $file" >&2
    missing=1
  fi
done
[[ $missing -eq 0 ]] || exit 1

push_secret() {
  local name="$1"
  echo "+ npx wrangler secret put $name --env $env"
  read_value "$name" | npx wrangler secret put "$name" --env "$env"
}

pushed=0
for name in ${REQUIRED_SECRETS[@]+"${REQUIRED_SECRETS[@]}"}; do
  push_secret "$name"
  pushed=$((pushed + 1))
done
for name in ${OPTIONAL_SECRETS[@]+"${OPTIONAL_SECRETS[@]}"}; do
  if [[ -n "$(read_value "$name")" ]]; then
    push_secret "$name"
    pushed=$((pushed + 1))
  else
    echo "note: $name is empty/missing in $file — skipping (declared optional)"
  fi
done

echo "done: $pushed secret(s) pushed to $env"
