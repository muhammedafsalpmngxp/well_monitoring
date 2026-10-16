#!/bin/sh
set -eu
TARGET=/usr/share/nginx/html/env.js

CP="${TWISE_CONTROL_PLANE_API_URL:-}"
TENANT="${TWISE_TENANT_API_URL:-}"
API_BASE="${TWISE_API_BASE_URL:-$TENANT}"
VERSION="${TWISE_APP_VERSION:-unknown}"

if [ -z "$CP" ] || [ -z "$TENANT" ]; then
  echo "[twise-env] FATAL: TWISE_CONTROL_PLANE_API_URL and TWISE_TENANT_API_URL are required" >&2
  exit 1
fi

cat > "$TARGET" <<EOF
// Generated at container start. Do not edit.
window.__TWISE_ENV__ = {
  controlPlaneApiUrl: "${CP}",
  tenantApiUrl: "${TENANT}",
  apiBaseUrl: "${API_BASE}",
  appVersion: "${VERSION}"
};
EOF

echo "[twise-env] wrote ${TARGET} (cp=${CP} tenant=${TENANT} v=${VERSION})"
