// Dev defaults for `ng serve`: the APIs on the same host the page was opened on, so one file works on a developer
// PC (http://localhost:4200 -> localhost) and on a server (http://<server>:4200 -> <server>) with the same ports.
// Overwritten at container start by docker/40-twise-runtime-env.sh from TWISE_* environment variables.
(function () {
  var host = window.location.protocol + '//' + window.location.hostname;
  window.__TWISE_ENV__ = {
    controlPlaneApiUrl: host + ':7007',
    tenantApiUrl: host + ':5069/api',
    apiBaseUrl: host + ':5069/api',
    appVersion: 'v1.0.0-dev',
  };
})();
