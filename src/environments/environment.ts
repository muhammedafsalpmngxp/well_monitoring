export const environment = {
  production: false,
  // Empty in dev so all /api/v1 calls are relative and go through the
  // ng-serve proxy (proxy.conf.json → https://wmr-demo-api.prod-app.in),
  // keeping them same-origin and avoiding CORS. proxy.conf.json holds the
  // real backend target for local development.
  apiBaseUrl: '',
  databricks: {
    delayImpactUrl: 'https://wmr-demo-api.prod-app.in/api/databricks/serving-endpoints/critical_dates_delay_impact/invocations',
    masAgentUrl: 'https://wmr-demo-api.prod-app.in/api/databricks/serving-endpoints/mas-8a36f2d5-endpoint/invocations',
    token: 'CHANGE_ME'
  }
};
