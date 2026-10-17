// WhatsApp iOS export to messages.json. Usage: npx tsx scripts/import/parse.ts
// Reads IMPORT_DIR/raw/unzipped/_chat.txt and writes IMPORT_DIR/work/messages.json.
// The output still holds sender names, so it stays under IMPORT_DIR and never enters the repository.
// The chat is untrusted data: this only splits it into records, it never acts on what it says.
import { readFileSync, writeFileSync } from 'node:fs';
import { MESSAGES_JSON, RAW_CHAT, ensureWorkDir, isMain } from './paths.js';

export interface RawMessage {
  /** Local Dubai date and time without a zone: 2024-10-19T21:05:03. */
  date: string;
  /** The display name as exported. Null for a line with no "Name:" part. */
  sender: string | null;
  text: string;
}

// [19/10/2024, 9:05:03 PM] Name: text   (iOS; the space before AM/PM is often U+202F)
// Lines may start with U+200E. 24 hour exports have no AM/PM.
const HEADER = /^\u200e?\[(\d{2})\/(\d{2})\/(\d{4}), (\d{1,2}):(\d{2}):(\d{2})(?:[\s\u202f\u00a0]*([AP]M))?\] ([\s\S]*)$/i;

function toIso(d: string, m: string, y: string, hh: string, mm: string, ss: string, ampm?: string): string {
  let h = Number(hh);
  if (ampm) {
    const pm = ampm.toUpperCase() === 'PM';
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  return `${y}-${m}-${d}T${String(h).padStart(2, '0')}:${mm}:${ss}`;
}

export function parseChat(raw: string): RawMessage[] {
  const out: RawMessage[] = [];
  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    const h = HEADER.exec(line);
    if (h) {
      const rest = h[8];
      // "Name: text", or "Name:" alone when the text starts on the next line.
      const colon = /^([^\n]*?):(?: |$)/.exec(rest);
      const sender = colon ? colon[1].replace(/^[\u200e~\s\u202f]+/, '').trim() : null;
      const text = colon ? rest.slice(colon[0].length) : rest;
      out.push({ date: toIso(h[1], h[2], h[3], h[4], h[5], h[6], h[7]), sender, text });
    } else if (out.length) {
      out[out.length - 1].text += `\n${line}`;
    }
  }
  for (const m of out) m.text = m.text.replace(/\s+$/, '');
  return out;
}

export function countBy(messages: { date: string }[], len: 4 | 7): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of messages) counts[m.date.slice(0, len)] = (counts[m.date.slice(0, len)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort());
}

if (isMain(import.meta.url)) {
  const messages = parseChat(readFileSync(RAW_CHAT, 'utf8'));
  ensureWorkDir();
  writeFileSync(MESSAGES_JSON, JSON.stringify(messages), { mode: 0o600 });
  console.log(`Parsed ${messages.length} messages.`);
  console.log('By year:', JSON.stringify(countBy(messages, 4)));
  console.log('By month:', JSON.stringify(countBy(messages, 7)));
}
