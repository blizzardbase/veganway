import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// E2E_PORT lets parallel worktrees run the suite side by side.
const PORT = Number(process.env.E2E_PORT || 4391);
const ORIGIN = `http://127.0.0.1:${PORT}`;

const MAIL_DIR = process.env.VW_E2E_MAIL_DIR ?? mkdtempSync(join(tmpdir(), 'vw-e2e-mail-'));
process.env.VW_E2E_MAIL_DIR = MAIL_DIR;

const phone = { browserName: 'chromium' as const, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: ORIGIN,
    launchOptions: process.env.VW_E2E_BROWSER_PATH ? { executablePath: process.env.VW_E2E_BROWSER_PATH } : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'phone-360-light', use: { ...phone, viewport: { width: 360, height: 800 }, colorScheme: 'light' } },
    { name: 'phone-360-dark', use: { ...phone, viewport: { width: 360, height: 800 }, colorScheme: 'dark' } },
    { name: 'phone-390-light', use: { ...phone, viewport: { width: 390, height: 844 }, colorScheme: 'light' } },
    { name: 'phone-390-dark', use: { ...phone, viewport: { width: 390, height: 844 }, colorScheme: 'dark' } },
  ],
  // A fresh production build served with the vercel.json headers (CSP included), on in memory PGlite.
  webServer: {
    command: 'npm run build && node --import tsx server/dev.ts',
    url: `${ORIGIN}/manifest.webmanifest`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(PORT),
      APP_ORIGIN: ORIGIN,
      DATABASE_URL: 'pglite://memory',
      VW_E2E_RELAXED_LIMITS: '1',
      VW_E2E_MAIL_DIR: MAIL_DIR,
      SERVER_SECRET: 'e2e-only-secret-0123456789abcdef0123456789',
    },
  },
});
