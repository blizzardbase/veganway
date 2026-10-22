# Tech stack

Every version is pinned exactly and was published at least 14 days before 2026-10-16. `package.json` overrides pin transitive packages that would otherwise resolve to newer releases.

## Language: TypeScript 6.0.3

Why: one type system across server, client and shared API types.
Beat: TypeScript 7.0.2, the native port, because `typescript-eslint` 8.71 supports only versions below 6.1.

## Server: Node 22.22 or later, Express 5.2.1

Why: Express exports straight into a Vercel function and runs the same way locally and in tests.
Beat: Hono and Fastify, because the v1 code and its origin and CSRF pattern were already Express.

## Validation: Zod 4.6.5

Why: every request body is parsed at the edge with readable messages.
Beat: hand written checks, which drift from the types.

## Database: PostgreSQL. Neon in production through pg 8.23.1; PGlite 0.5.8 for tests and local dev

Why: real Postgres full text search (`tsvector`, `websearch_to_tsquery`), one SQL dialect everywhere, and an in process Postgres so tests need no server.
Beat: Turso and libSQL, which the council first proposed. Its search would have been LIKE now and FTS5 later, and its transaction model needed workarounds.

## Migrations: numbered SQL files with a small runner

Why: plain SQL is easy to review; reserved number ranges let three builders add migrations without clashing.
Beat: an ORM migration tool, which would add a dependency and hide the SQL.

## Photos: Vercel Blob 2.8.0, public store, served through a same origin rewrite

Why: the CSP can stay `'self'` while images live in Blob; random suffixes make paths unguessable.
Beat: private Blob, which adds a signed call per image for content that is public by intent.

## Frontend: React 19.3.0, React DOM 19.3.0, React Router 8.4.0, TanStack Query 5.104.1

Why: ten screens, sheets and optimistic votes are far cheaper in React than in the v1 template strings. React Router gives scroll restoration; React Query gives caching and refetch on focus.
Beat: the v1 vanilla DOM renderer, and Next.js, which brings server rendering this app does not need.

## Styling: Tailwind CSS 4.3.3 through @tailwindcss/vite 4.3.3

Why: design tokens live once in `@theme`; light and dark swap by CSS variables; nothing ships at runtime.
Beat: a component library, which would add weight and a look that is not ours.

## Motion: motion 13.5.1 with LazyMotion and domAnimation

Why: toasts and the name reveal animate smoothly and respect reduced motion.
Beat: motion 14, a fresh major release at build time.

## Icons and font: `lucide-react` 1.50.0, `@fontsource-variable/manrope` 5.3.0

Why: icons import one by one; the font is self hosted so the page makes no third party request.
Beat: Google Fonts, which is a third party request.

## Build: Vite 8.3.2 with `@vitejs/plugin-react` 6.1.1

Why: fast builds and a dev server that runs inside Express in middleware mode.
Beat: webpack, which is slower and needs more config.

## Tests: `node:test` through tsx 4.23.15, Playwright 1.63.0, `@axe-core/playwright` 4.13.0

Why: one API test runner that needs no extra framework; Playwright for phone sized flows in light and dark; axe for accessibility in the same run.
Beat: Vitest, because node:test already covers the API tests and one runner is the rule.

## Lint: ESLint 10.12.0, `typescript-eslint` 8.71.0, `eslint-plugin-react-hooks` 7.1.1

Why: catches hook mistakes and unused code across server and client.
Beat: Biome, because the v1 repository already used ESLint.

## Hosting: Vercel, function region fra1

Why: Neon runs in Frankfurt, so the function sits next to the database.
Beat: a VPS, which would need TLS, process management and backups by hand.

## Email: Resend, REST API through `fetch`, no SDK

Why: the free plan covers 3,000 mails a month, one `POST /emails` sends a reset link, and a send only key limits the damage if it leaks. Used only for password reset links, with open and click tracking off.
Beat: SMTP through a personal webmail account with an app password, which ties the app to a personal account, and sending from an existing domain whose DNS sits on Cloudflare, which was not needed once `veganwaydxb.com` is bought in Vercel.
