// Auth

export interface RequestCodeRequest {
  phone: string;
}

export interface RequestCodeResponse {
  sent: boolean;
  expiresIn: number; // seconds
}

export interface LoginRequest {
  phone: string;
  code: string;
}

export interface AuthUser {
  id: string;
  name: string;
  phone: string | null;
  isNew: boolean;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
  refreshToken: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  token: string;
  refreshToken: string;
}
