#!/usr/bin/env bash

# Toggle whether the production worker is publicly reachable, by turning the
# Cloudflare Access wall on its workers.dev hostname off/on.
#
#   on     make production public: attach a reusable Bypass/Everyone policy to
#          the existing (one-click) Access app for the production hostname.
#          Access stops enforcing AND stops logging; the app's own GitHub
#          OAuth sign-in becomes the only gate.
#   off    re-protect production: detach that bypass policy again. The
#          one-click app's own "<worker> - Production" allow policy is never
#          touched, so off restores exactly the previous behaviour.
#   status report whether the bypass is attached and what the hostname
#          actually serves right now (works with a read-only token).
#
# The deploy smoke test is unaffected in both directions: it authenticates
# with an Access service token (see README "Cloudflare Access").
#
# Usage:
#   CLOUDFLARE_API_TOKEN=... scripts/set-prod-public-access.sh <on|off|status> [--yes]
#
# "on" asks for confirmation on a TTY and requires --yes without one.
#
# Requires:
#   - CLOUDFLARE_API_TOKEN with account-scoped write access to BOTH Access
#     apps and Access policies — the combined "Access: Apps and Policies ->
#     Edit" group, or "Access: Apps Write" AND "Access: Policies Write" where
#     the token builder offers them separately.
#   - CLOUDFLARE_ACCOUNT_ID in the environment, or in .dev.vars.
#   - jq.
set -euo pipefail

PROD_HOST="llm-prices.generality.workers.dev" # adjust if your workers.dev subdomain differs
BYPASS_POLICY_NAME="llm-prices production public (Access off)"


mode="${1:-}"
case "$mode" in
  on | off | status) ;;
  *)
    echo "usage: $0 <on|off|status> [--yes]" >&2
    exit 1
    ;;
esac

command -v jq > /dev/null || {
  echo "error: jq is required (brew install jq)" >&2
  exit 1
}

[[ -n "${CLOUDFLARE_API_TOKEN:-}" ]] || {
  echo "error: CLOUDFLARE_API_TOKEN is not set" >&2
  exit 1
}

account_id="${CLOUDFLARE_ACCOUNT_ID:-}"
if [[ -z "$account_id" && -f .dev.vars ]]; then
  line="$(grep -E '^CLOUDFLARE_ACCOUNT_ID=' .dev.vars | tail -n 1 || true)"
  account_id="${line#*=}"
  if [[ $account_id == \"*\" || $account_id == \'*\' ]]; then
    account_id="${account_id:1:${#account_id}-2}"
  fi
fi
[[ -n "$account_id" ]] || {
  echo "error: CLOUDFLARE_ACCOUNT_ID not set and not found in .dev.vars" >&2
  exit 1
}

base="https://api.cloudflare.com/client/v4/accounts/$account_id/access"

api() {
  local method="$1" path="$2" body="${3:-}" response
  local args=(-sS -X "$method" "$base/$path"
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
    -H "Content-Type: application/json")
  [[ -n "$body" ]] && args+=(--data "$body")
  response="$(curl "${args[@]}")"
  if [[ "$(jq -r '.success' <<< "$response")" != "true" ]]; then
    echo "error: $method $path failed; full response:" >&2
    jq '.' <<< "$response" >&2
    exit 1
  fi
  printf '%s' "$response"
}

# What does the hostname actually serve right now? "protected" if Access
# intercepts / with a redirect to the team domain, else "public".
live_state() {
  local probe
  probe="$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' "https://$PROD_HOST/" || true)"
  if [[ "$probe" == 30*cloudflareaccess.com* ]]; then echo protected; else echo public; fi
}

# The one-click app matches the bare hostname; our /health carve-out app has
# the path suffix, so an exact domain match cannot pick the wrong one.
app="$(api GET 'apps?per_page=100' \
  | jq --arg host "$PROD_HOST" '[.result[] | select(.domain == $host)] | first')"
if [[ "$app" == "null" ]]; then
  echo "error: no Access app found with domain exactly '$PROD_HOST'." >&2
  echo "hint: is the one-click Access toggle still enabled on the worker?" >&2
  exit 1
fi
app_id="$(jq -r '.id' <<< "$app")"

# Re-fetch the app individually: the attach/detach logic below rebuilds the
# full .policies list from this object, so it must be the complete app record,
# not a possibly-slimmed listing row.
app="$(api GET "apps/$app_id" | jq '.result')"
app_name="$(jq -r '.name' <<< "$app")"

bypass_id="$(api GET 'policies?per_page=100' \
  | jq -r --arg name "$BYPASS_POLICY_NAME" '.result[] | select(.name == $name) | .id' \
  | head -n 1)"

attached="no"
if [[ -n "$bypass_id" ]] \
  && jq -e --arg id "$bypass_id" '.policies[]? | select(.id == $id)' <<< "$app" > /dev/null; then
  attached="yes"
fi

if [[ "$mode" == "status" ]]; then
  echo "app:      $app_name ($app_id)"
  echo "policies: $(jq -r '[.policies[]?.name] | join(", ")' <<< "$app")"
  echo "bypass attached: $attached"
  echo "live:     https://$PROD_HOST/ is $(live_state)"
  exit 0
fi

if [[ "$mode" == "on" && "$attached" == "no" ]]; then
  echo "About to make https://$PROD_HOST/ reachable by ANYONE:"
  echo "  - Cloudflare Access stops enforcing and stops logging on this hostname"
  echo "  - the app's own GitHub OAuth sign-in becomes the only gate"
  if [[ "${2:-}" == "--yes" ]]; then
    :
  elif [[ -t 0 ]]; then
    read -r -p "Type 'public' to confirm: " answer
    [[ "$answer" == "public" ]] || {
      echo "aborted" >&2
      exit 1
    }
  else
    echo "error: refusing without --yes when not run interactively" >&2
    exit 1
  fi
fi

# Build the new policy attachment list. PUT replaces the app, so start from
# the GET result and only swap .policies — every other setting on the
# one-click app rides along unchanged. Precedence values must be unique.
if [[ "$mode" == "on" ]]; then
  if [[ "$attached" == "yes" ]]; then
    echo "already public: bypass policy is attached to $app_name"
  else
    if [[ -z "$bypass_id" ]]; then
      policy_body="$(jq -n --arg name "$BYPASS_POLICY_NAME" \
        '{name: $name, decision: "bypass", include: [{everyone: {}}]}')"
      bypass_id="$(api POST policies "$policy_body" | jq -r '.result.id')"
      echo "policy created: $BYPASS_POLICY_NAME ($bypass_id)"
    fi
    new_policies="$(jq --arg id "$bypass_id" \
      '[{id: $id, precedence: 1}]
       + ([.policies[]? | select(.id != $id)] | to_entries
          | map({id: .value.id, precedence: (.key + 2)}))' <<< "$app")"
  fi
else # off
  if [[ "$attached" == "no" ]]; then
    echo "already protected: bypass policy is not attached to $app_name"
  else
    new_policies="$(jq --arg id "$bypass_id" \
      '[.policies[]? | select(.id != $id)] | to_entries
       | map({id: .value.id, precedence: (.key + 1)})' <<< "$app")"
  fi
fi

if [[ -n "${new_policies:-}" ]]; then
  put_body="$(jq --argjson pol "$new_policies" \
    'del(.id, .uid, .aud, .created_at, .updated_at) | .policies = $pol' <<< "$app")"
  api PUT "apps/$app_id" "$put_body" > /dev/null
  echo "app updated: $app_name"
fi

# Verify from outside; Access config can take a moment to propagate.
want=$([[ "$mode" == "on" ]] && echo public || echo protected)
for _ in $(seq 1 12); do
  state="$(live_state)"
  [[ "$state" == "$want" ]] && break
  sleep 5
done
if [[ "$state" == "$want" ]]; then
  echo "verified: https://$PROD_HOST/ is $state"
else
  echo "error: https://$PROD_HOST/ is still $state (wanted $want) after 60s" >&2
  exit 1
fi
