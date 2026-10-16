export interface AppEnvironment {
  production: boolean;
  controlPlaneApiUrl: string;
  tenantApiUrl: string;
  apiBaseUrl: string;
  appVersion: string;
}

const FALLBACK = {
  controlPlaneApiUrl: 'http://localhost:7007',
  tenantApiUrl: 'http://localhost:5069/api',
  apiBaseUrl: 'http://localhost:5069/api',
  appVersion: 'v0.0.0-dev',
} as const;

/**
 * Reads config injected by public/env.js (overwritten at container start).
 * env.js is a classic <script> loaded before any Angular module code runs,
 * so window.__TWISE_ENV__ is always populated by the time this executes.
 */
export function readRuntimeEnv(production: boolean): AppEnvironment {
  const raw = (globalThis as { __TWISE_ENV__?: Partial<AppEnvironment> }).__TWISE_ENV__ ?? {};
  return {
    production,
    controlPlaneApiUrl: raw.controlPlaneApiUrl || FALLBACK.controlPlaneApiUrl,
    tenantApiUrl: raw.tenantApiUrl || FALLBACK.tenantApiUrl,
    apiBaseUrl: raw.apiBaseUrl || raw.tenantApiUrl || FALLBACK.apiBaseUrl,
    appVersion: raw.appVersion || FALLBACK.appVersion,
  };
}
