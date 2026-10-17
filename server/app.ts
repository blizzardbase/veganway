// The one Express app. Vercel runs it from api/index.ts; server/dev.ts runs it locally.
// It serves /api only. Static files come from Vercel (dist/client) or from server/dev.ts.
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import type { AppOptions, Deps } from './deps.js';
import { deriveKeys, scryptHasher } from './lib/crypto.js';
import { HttpError } from './lib/http.js';
import { loadSession } from './lib/auth.js';
import { DEFAULT_LIMITS } from './lib/rate.js';
import { router as authRouter } from './routes/auth.js';
import { router as listingsRouter } from './routes/listings.js';
import { router as photosRouter } from './routes/photos.js';
import { router as talkRouter } from './routes/talk.js';
import { router as servicesRouter } from './routes/services.js';
import { router as meRouter } from './routes/me.js';
import { router as adminRouter } from './routes/admin.js';
import { router as searchRouter } from './routes/search.js';
import { router as feedRouter } from './routes/feed.js';
import { router as reportsRouter } from './routes/reports.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function buildDeps(options: AppOptions): Deps {
  const origin = new URL(options.appOrigin).origin;
  const secure = origin.startsWith('https://');
  return {
    db: options.db,
    keys: deriveKeys(options.serverSecret),
    // __Host- cookies need Secure, so plain http local dev uses a different name.
    config: { origin, secure, cookieName: secure ? '__Host-vw_session' : 'vw_session' },
    passwords: options.passwords ?? scryptHasher,
    limits: { ...DEFAULT_LIMITS, ...options.limits },
    media: options.media,
  };
}

export function createApp(options: AppOptions): Express {
  const deps = buildDeps(options);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', options.trustProxy ?? false);

  // Private responses are never cached by the browser, a proxy or the service worker.
  const noStore: RequestHandler = (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  };

  // Writes must come from our own page. Browsers always send Origin on a cross site or same origin POST.
  const originCheck: RequestHandler = (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.headers.origin !== deps.config.origin) {
      res.status(403).json({ error: 'Request origin not allowed.', code: 'bad_origin' });
      return;
    }
    next();
  };

  // A signed in write must carry the session's CSRF token.
  const csrfCheck: RequestHandler = (req, res, next) => {
    const s = res.locals.session;
    if (SAFE_METHODS.has(req.method) || !s) return next();
    if (req.headers['x-csrf-token'] !== s.csrf) {
      res.status(403).json({ error: 'Your session changed. Refresh and try again.', code: 'bad_csrf' });
      return;
    }
    next();
  };

  app.use('/api', noStore, originCheck, express.json({ limit: '100kb' }), loadSession(deps), csrfCheck);

  // One router per file, each mounted at /api. Each file's header lists the paths it owns.
  app.use('/api', authRouter(deps));
  app.use('/api', listingsRouter(deps));
  app.use('/api', photosRouter(deps));
  app.use('/api', talkRouter(deps));
  app.use('/api', servicesRouter(deps));
  app.use('/api', meRouter(deps));
  app.use('/api', adminRouter(deps));
  app.use('/api', searchRouter(deps));
  app.use('/api', feedRouter(deps));
  app.use('/api/reports', reportsRouter(deps));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found.', code: 'not_found' });
  });

  // Logs the error name only: never a message, body, email, IP or user agent.
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, code: err.code, field: err.field });
      return;
    }
    const e = err as { name?: string; type?: string; status?: number };
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'The request body is not valid JSON.', code: 'bad_json' });
      return;
    }
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ error: 'That is too large.', code: 'too_large' });
      return;
    }
    console.error('request_failed', typeof e?.name === 'string' ? e.name : 'Error');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'server_error' });
  };
  app.use(onError);

  return app;
}
