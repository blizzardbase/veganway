// Types shared by server and client for the auth foundation.
// Slices put their own shared types in shared/<slice>.ts, not here, to avoid edit conflicts.

export type Role = 'member' | 'admin';

export interface Me {
  id: string;
  pseudonym: string;
  pseudonymConfirmed: boolean;
  displayName: string | null;
  bio: string | null;
  avatarPhotoId: string | null;
  role: Role;
  hasService: boolean;
  createdAt: string;
}

/** GET /api/me. Signed out visitors get { user: null, csrf: null }. */
export interface MeResponse {
  user: Me | null;
  csrf: string | null;
}

/** POST /api/auth/signup and POST /api/auth/reset. The recovery code is shown once. */
export interface AccountWithCodeResponse {
  user: Me;
  csrf: string;
  /** 20 Crockford base32 characters formatted as XXXX-XXXX-XXXX-XXXX-XXXX. */
  recoveryCode: string;
}

/** POST /api/auth/login, /api/auth/shuffle, /api/auth/confirm-pseudonym, /api/auth/password. */
export interface AuthResponse {
  user: Me;
  csrf: string;
}

export interface RecoveryCodeResponse {
  recoveryCode: string;
}

export interface ApiErrorBody {
  error: string;
  code?: string;
}

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
