// Where the WhatsApp import keeps its data. Everything here can hold member names or numbers,
// so it lives outside the repository, in a folder only the owner can read.
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const IMPORT_DIR = process.env.VW_IMPORT_DIR ?? join(homedir(), '.local/state/veganfood/import');
export const RAW_CHAT = join(IMPORT_DIR, 'raw/unzipped/_chat.txt');
export const WORK_DIR = join(IMPORT_DIR, 'work');
export const MESSAGES_JSON = join(WORK_DIR, 'messages.json');
export const REDACTED_JSON = join(WORK_DIR, 'redacted.json');
export const STATS_JSON = join(WORK_DIR, 'stats.json');
export const RECORDS_JSON = join(WORK_DIR, 'records.json');
export const PREVIEW_HTML = join(WORK_DIR, 'preview.html');
export const HMAC_KEY_FILE = join(IMPORT_DIR, 'hmac.key');

export function ensureWorkDir(): void {
  mkdirSync(WORK_DIR, { recursive: true, mode: 0o700 });
}

/** True when the module is the script node was asked to run. */
export function isMain(metaUrl: string): boolean {
  return !!process.argv[1] && new URL(metaUrl).pathname === process.argv[1];
}
