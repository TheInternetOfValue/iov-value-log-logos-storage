#!/bin/sh
# Runs the Logos Storage node (loopback API) and the authenticating Caddy proxy.
# Exits when either process stops so the host restarts the container.
set -eu
: "${LOGOS_STORAGE_TOKEN:?LOGOS_STORAGE_TOKEN is required}"
if [ "${#LOGOS_STORAGE_TOKEN}" -lt 32 ]; then echo "LOGOS_STORAGE_TOKEN must be at least 32 characters" >&2; exit 1; fi
export LOGOS_API_PORT="${LOGOS_API_PORT:-8081}"
DATA_DIR="${LOGOS_DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"

# --block-ttl: keep blocks ~10 years (0 wipes them on restart in v0.5.3). --advertise-content=false: this node is the only provider.
logos-storage \
  --data-dir="$DATA_DIR/storage" \
  --api-bindaddr=127.0.0.1 --api-port="$LOGOS_API_PORT" \
  --block-ttl=315360000 --advertise-content=false \
  --storage-quota="${LOGOS_STORAGE_QUOTA:-10737418240}" \
  --log-format=json --log-level=info &
node_pid=$!

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy_pid=$!

trap 'kill "$node_pid" "$caddy_pid" 2>/dev/null' INT TERM
while kill -0 "$node_pid" 2>/dev/null && kill -0 "$caddy_pid" 2>/dev/null; do sleep 5; done
kill "$node_pid" "$caddy_pid" 2>/dev/null || true
exit 1
