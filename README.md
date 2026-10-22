# VeganWay DXB

A free, open source (MIT), phone first community web app for the Dubai Vegan Community WhatsApp group. Members find vegan places, products and home bakers, recommend them, share offers, talk and run polls. It launches empty: members fill it in.

Use it at https://veganway-dxb.vercel.app. This repository is the complete source of that site, published so any member can check exactly what it stores and what it does not. Questions and fixes are welcome as GitHub issues or pull requests.

## Privacy in one paragraph

Accounts need only an email and a password. Use an email you can open. We only use it to send you a reset link, and we never store it. The server stores an HMAC of the email, never the email itself, and sends a password reset link only when requested. The group admin decided on 17 October 2026 to remove recovery codes. Reset links last 30 minutes and work once. Resend receives the address just typed and the message for delivery. Open and click tracking are disabled before sending. There is no analytics, no third party script, font or image, and a strict Content Security Policy. The database and logs hold no IP address, user agent or email.

## Run it locally

Node 22.22 or later.

```sh
npm ci
npm run dev
```

`npm run dev` starts the API and the Vite dev server together on http://localhost:4317. With no `DATABASE_URL` it uses PGlite, an in process Postgres, stored in `data/dev-pglite`, and applies migrations on start. With no `SERVER_SECRET` it creates a local one in `data/dev-secret`. The `data/` folder is git ignored. Development mail is recorded in memory and never sent. Playwright uses a private temporary mail folder and an in memory database; its JSON messages contain synthetic addresses only. `VW_E2E_MAIL_DIR` is honored only by that isolated test server.

To try the production build locally, with the same security headers as Vercel:

```sh
npm run build
npm start
```

For a named local link, register the port with portless and set `APP_ORIGIN` to match, for example `APP_ORIGIN=https://veganway.localhost`.

PGlite allows one process at a time. Stop `npm run dev` before running `npm run admin` against the local database.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | API plus Vite with hot reload, on PGlite unless `DATABASE_URL` is set |
| `npm start` | API plus the built client from `dist/client`, with the `vercel.json` headers |
| `npm run build` | Builds the client into `dist/client` |
| `npm run typecheck` | Type checks client, server and tooling |
| `npm run lint` | ESLint over the whole repository |
| `npm test` | API tests on in memory PGlite (`tests/api`) |
| `npm run test:dist` | Fails if any old sample name or sample image is in `dist/` |
| `npm run e2e` | Builds, serves and runs Playwright at 360 by 800 and 390 by 844, light and dark |
| `npm run verify` | All of the above, in order |
| `npm run migrate` | Applies pending SQL migrations to `DATABASE_URL` |
| `npm run admin -- grant --email you@example.com` | Grants admin. Also `revoke`, and `--pseudonym "Name"` instead of `--email` |

Playwright needs Chromium once: `npx playwright install chromium`.

## Environment

See `.env.example`. Secrets come from the environment only. Never commit `.env.local`.

| Variable | Where | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | Vercel, migrate, admin | `postgres://` (Neon, pooled) or `pglite://memory` or `pglite://<dir>` |
| `SERVER_SECRET` | Vercel, admin | 32 or more random bytes. HKDF derives the email and rate limit keys. Losing it locks every account out |
| `APP_ORIGIN` | Vercel, local | The exact origin people use. Writes from any other origin are refused. `https` switches the cookie to `__Host-vw_session` |
| `RESEND_API_KEY`, `MAIL_FROM` | production | Resend sending access key limited to the sender's domain, and a verified sender. Each reset is one call to `POST /emails`. Keep open and click tracking off for the domain in the Resend dashboard. Without these, reset is unavailable. Never use real credentials in tests |
| `BLOB_READ_WRITE_TOKEN` | Vercel | Vercel Blob public store for photos |
| `VW_E2E_BROWSER_PATH` | tests | Optional executable path for the isolated Playwright browser, such as Brave |
| `PORT`, `HOST` | local | Local server address. Defaults 4317 and 127.0.0.1 |

## Layout

```
api/index.ts          Vercel function entry: exports the Express app
server/app.ts         createApp(options): middleware, one router per file, error handler
server/db.ts          createDb({ url }) over pg (Neon) or PGlite
server/migrate.ts     Applies server/migrations/NNN_name.sql in order
server/routes/*.ts    auth.ts is complete; the others are stubs owned by slices
server/lib/*.ts       auth guards, rate limits, crypto, caps, contact check, pseudonyms, audit, media, public author columns
server/cli/admin.ts   npm run admin
server/cli/vercel-migrate.ts  Migrates during production Vercel builds only
src/main.tsx, app.tsx React entry and routes
src/screens/          One file per screen
src/ui/               The UI kit
src/features/         Add sheet, auth gate and the slice owned Add forms
tests/                API tests, the dist scan and Playwright specs
```

### Rules for slice builders

Each slice owns its files and touches no one else's.

| Slice | Server | Client | Migrations |
| --- | --- | --- | --- |
| Listings | `routes/listings.ts`, `routes/photos.ts` | `screens/Explore.tsx`, `screens/ListingDetail.tsx`, `features/listings/*` | 010 to 019 |
| Talk | `routes/talk.ts` | `screens/Talk.tsx`, `screens/Topic.tsx`, `features/talk/*` | 020 to 029 |
| Services, Me, Admin, Search | `routes/services.ts`, `me.ts`, `admin.ts`, `search.ts`, `feed.ts` | `screens/ServiceProfile.tsx`, `Me.tsx`, `Admin.tsx`, `Search.tsx`, `Home.tsx`, `Privacy.tsx`, `features/services/*` | 030 to 039 |

Every router is mounted at `/api`; its file header lists the paths it owns. Shared types for a slice go in `shared/<slice>.ts`. Tests go in `tests/api/<slice>.test.ts` and use `makeTestApp`, `signUp` and `asAdmin` from `tests/helpers.ts`.

## Deploy

`vercel.json` builds the client, serves `dist/client`, runs `api/index.ts` in `fra1` next to Neon, rewrites `/media/*` to the Blob store and sends the CSP and security headers. Replace the `BLOB_BASE_URL` placeholder in the `/media` rewrite with the real store host before the first deploy. Production builds migrate: `npm run vercel-build` runs `server/cli/vercel-migrate.ts`, which applies pending migrations to `DATABASE_URL` only when `VERCEL_ENV` is `production`. Preview and development builds skip migrations and exit 0, so a branch preview never changes the production schema. Analytics, Speed Insights and the preview toolbar stay off.

## Licence

MIT.
