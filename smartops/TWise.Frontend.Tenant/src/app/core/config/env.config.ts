import { environment } from '../../../environments/environment';

export const ENV_CONFIG = {
  apiBaseUrl:  environment.apiBaseUrl,
  production:  environment.production,
  appVersion:  environment.appVersion,
} as const;
