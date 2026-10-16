export interface User {
  userId: number;
  email: string;
  displayName: string;
  role: string;
  tenantId: number;
  avatar?: string;
  permissions?: string[];
}

export interface LoginCredentials {
  email: string;
  password: string;
}

/** Matches the flat response from POST /auth/login on ControlPlane API */
export interface LoginResponse {
  token: string;
  refreshToken: string;
  userId: number;
  email: string;
  displayName: string;
  role: string;
  tenantId: number;
}
