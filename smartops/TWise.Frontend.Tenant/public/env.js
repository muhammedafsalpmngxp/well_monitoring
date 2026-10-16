// Local-dev defaults. Overwritten at container start by
// docker/40-twise-runtime-env.sh from TWISE_* environment variables.
window.__TWISE_ENV__ = {
  controlPlaneApiUrl: 'http://localhost:7007',
  tenantApiUrl: 'http://localhost:5069/api',
  apiBaseUrl: 'http://localhost:5069/api',
  appVersion: 'v1.0.0-dev',
};
