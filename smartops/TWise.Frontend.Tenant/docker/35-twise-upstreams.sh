#!/bin/sh
# Generates the controlplane/tenant upstream blocks at container start.
#
# ECS Service Connect puts both an IPv4 (127.255.x.x) and an IPv6 (2600:f0f0::x)
# address for each alias in /etc/hosts, but the task has no IPv6 route. If
# nginx resolves the alias itself it keeps both peers and logs a
# "connect() ... Network unreachable" error every time it tries the IPv6 one.
# nginx's own resolver does not read /etc/hosts, so resolve the IPv4 address
# here and pin the upstream to it. Falls back to the name as given (e.g. when
# not on Service Connect, or if no IPv4 is found).
set -eu
OUT=/etc/nginx/conf.d/00-twise-upstreams.conf

pin() {
  name="$1"; hostport="$2"
  host="${hostport%:*}"; port="${hostport##*:}"
  ip="$(getent ahostsv4 "$host" 2>/dev/null | awk 'NR==1{print $1}' || true)"
  if [ -n "$ip" ]; then
    target="${ip}:${port}"
  else
    target="$hostport"
  fi
  # max_fails=0: never mark the peer down, so a transient failure can't 502.
  printf 'upstream %s {\n    server %s max_fails=0;\n}\n\n' "$name" "$target"
  echo "[twise-upstreams] ${name} -> ${target} (from ${hostport})" >&2
}

{
  pin controlplane_up "${TWISE_CONTROLPLANE_UPSTREAM:-controlplane:8080}"
  pin tenant_up "${TWISE_TENANT_UPSTREAM:-tenant:8080}"
} > "$OUT"
