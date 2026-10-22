// What every router receives. Slice routers read from deps; they never import process.env.
import type { Db } from './db.js';
import type { Keys, PasswordHasher } from './lib/crypto.js';
import type { Limits } from './lib/rate.js';
import type { Mailer } from './lib/mailer.js';
import type { MediaStore } from './lib/media.js';

export interface AppConfig {
  /** Exact origin the browser uses, e.g. https://veganway.example. Writes from any other Origin get 403. */
  origin: string;
  /** True when origin is https. Then the cookie is __Host-vw_session and Secure. */
  secure: boolean;
  cookieName: string;
}

export interface Deps {
  db: Db;
  keys: Keys;
  config: AppConfig;
  passwords: PasswordHasher;
  limits: Limits;
  media: MediaStore;
  mailer: Mailer;
}

export interface AppOptions {
  db: Db;
  serverSecret: string;
  appOrigin: string;
  media: MediaStore;
  mailer: Mailer;
  /** Express "trust proxy" setting. Vercel: 1. Local: false. */
  trustProxy?: boolean | number;
  /** Tests inject a counting wrapper here. Defaults to scrypt. */
  passwords?: PasswordHasher;
  /** Tests may loosen or tighten individual rules. */
  limits?: Partial<Limits>;
}
