// messages.json to redacted.json. Usage: npx tsx scripts/import/redact.ts
// Each sender becomes an opaque id (HMAC of the name with a random key kept under IMPORT_DIR).
// Phone numbers, emails, wa.me links and @mentions leave the text, and so do the senders' own names.
// System lines (joined, left, added, subject changes, security codes, deleted, media omitted, null) are dropped.
// Only the redacted output is ever read for extraction.
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { containsContact } from '../../server/lib/contact.js';
import type { RawMessage } from './parse.js';
import { HMAC_KEY_FILE, MESSAGES_JSON, REDACTED_JSON, STATS_JSON, ensureWorkDir, isMain } from './paths.js';

export interface RedactedMessage {
  date: string;
  senderId: string;
  text: string;
}

export interface RedactStats {
  parsed: number;
  kept: number;
  senders: number;
  dropped: Partial<Record<DropReason, number>>;
}

export type DropReason =
  | 'no_sender'
  | 'joined_left_added'
  | 'subject_or_settings'
  | 'security_code'
  | 'encryption_notice'
  | 'deleted'
  | 'media_omitted'
  | 'null'
  | 'empty'
  | 'contact_guard';

export function senderId(key: Buffer, name: string): string {
  return `m_${createHmac('sha256', key).update(name.normalize('NFKC').trim().toLowerCase()).digest('hex').slice(0, 12)}`;
}

const MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Why a line is a system line, or null when it is a real message. */
export function systemReason(text: string): DropReason | null {
  const t = text.replace(MARKS, '').trim();
  if (t === 'null') return 'null';
  if (/^(?:image|video|audio|sticker|gif|document|contact card|video note)s? omitted$/i.test(t) || /^<attached: [^>]*>$/i.test(t)) return 'media_omitted';
  if (/^(?:this message was deleted(?: by admin .*)?|you deleted this message)\.?$/i.test(t)) return 'deleted';
  if (/security code (?:with .* )?changed|security code changed/i.test(t)) return 'security_code';
  if (/end-to-end encrypted/i.test(t)) return 'encryption_notice';
  // System lines from WhatsApp itself begin with U+200E in iOS exports; members' text does not.
  const system = /^[\u200e]/.test(text);
  if (/joined using (?:this group's invite link|a group link)|joined from the community|\bjoined$|\bleft$|^.{1,80} (?:added|removed) .{1,200}$|^you were added|requested to join|was added$|created (?:this )?group/i.test(t) && system) {
    return 'joined_left_added';
  }
  if (system && /changed (?:the subject|this group's|the group|their phone number|the settings|.{0,80} to )|pinned a message|is now an admin|no longer an admin|turned (?:on|off) disappearing|deleted this group's icon|changed the group description/i.test(t)) {
    return 'subject_or_settings';
  }
  return null;
}

// Phone numbers in UAE and Indian formats, with spaces, dots, dashes or brackets between digits:
// +971 50 123 4567, 050 123 4567, 04 123 4567, 00971501234567, +91 98765 43210, 98765-43210.
// Seven or more digits in one run counts as a number.
export const PHONE = /(?:\+|\b00)?\(?\d(?:[\s().\u00a0\u202f-]{0,3}\d){6,}/g;
const EMAIL = /[\w.+-]+\s*@\s*[\w-]+(?:\s*\.\s*[\w-]+)*\s*\.\s*[a-z]{2,}/gi;
const WA_LINK = /(?:https?:\/\/)?(?:api\.)?(?:wa\.me|whatsapp\.com\/send|chat\.whatsapp\.com)\/?\S*/gi;
// iOS mentions are wrapped in isolate marks: @\u2068~Name\u2069. Plain @handles and @numbers too.
const MENTION = /@\u2068[^\u2069]*\u2069|@[~+]?[\p{L}\p{N}_.]+/gu;

/**
 * A display name that reads like a business (a bakery posting as itself) is not a person's name.
 * Scrubbing it would erase the very business names the import is looking for.
 */
export const BUSINESS = /\b(?:bake|bakes|bakery|bakehouse|kitchen|cafe|café|food|foods|eats|vegan|plant|plants|cheese|co|company|store|shop|catering|studio|official|dubai|uae|life|organic|market|deli|cake|cakes|treats|sweets|restaurant|brand|ltd|llc|fzco|fze)\b/i;

/** A name word followed by one of these is part of a business name ("Rose Bakehouse"), so it stays. */
const BUSINESS_NOUN = '(?:Bakehouse|Bakery|Bakes|Kitchen|Cafe|Café|Cheese|Cheeses|Foods?|Eats|Cakes|Treats|Creamery|Deli|Pantry|Patisserie|Tempeh|Catering)\\b';

/** Words that can begin a member's name but are too common to scrub on their own. */
const COMMON = new Set(['the', 'and', 'for', 'vegan', 'dubai', 'mrs', 'miss', 'chef', 'mom', 'mum', 'dad', 'home', 'kitchen']);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replaces the senders' names and name words, so a member's name never survives in the text. */
export type NameScrubber = (text: string) => string;

const bounded = (alts: string[], flags: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, flags);

/**
 * Full display names match in any case. Single name words match only when capitalised in the text,
 * as names usually are, so a member called "Will" or "Sandy" does not wipe out ordinary words.
 * A name that the chat ever puts straight before a business noun ("Rose Bakehouse") is a business
 * posting as itself, so it is kept everywhere. Pass the message texts to enable that check.
 */
export function nameScrubber(senders: Iterable<string>, texts: string[] = []): NameScrubber {
  const full = new Set<string>();
  const words = new Set<string>();
  for (const raw of senders) {
    const name = raw.replace(MARKS, '').replace(/^~\s*/, '').trim();
    if (!name || /^\+?[\d\s().-]+$/.test(name) || BUSINESS.test(name)) continue;
    if (name.replace(/[^\p{L}]/gu, '').length >= 3) full.add(name);
    for (const part of name.split(/\s+/)) {
      const p = part.replace(/[^\p{L}'-]/gu, '');
      if (p.length >= 3 && !COMMON.has(p.toLowerCase())) words.add(p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
    }
  }
  const corpus = texts.join('\n');
  const isBusiness = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?:['’]s)?\\s+${BUSINESS_NOUN}`, 'iu').test(corpus);
  const keep = (set: Set<string>) => [...set].filter((w) => !isBusiness(w));
  const fullAlts = keep(full);
  const wordAlts = keep(words);
  const fullRe = fullAlts.length ? new RegExp(`${bounded(fullAlts, '').source}(?!(?:['’]s)?\\s+${BUSINESS_NOUN})`, 'giu') : null;
  const wordRe = wordAlts.length
    ? new RegExp(`${bounded(wordAlts.flatMap((w) => [w, w.toUpperCase()]), '').source}(?!(?:['’]s)?\\s+${BUSINESS_NOUN})`, 'gu')
    : null;
  return (text) => {
    let t = fullRe ? text.replace(fullRe, '[member]') : text;
    if (wordRe) t = t.replace(wordRe, '[member]');
    return t;
  };
}

/** Remove contact details, mentions and member names from one message's text. */
export function redactText(text: string, scrub: NameScrubber = (t) => t): string {
  let t = text.replace(/\s*<This message was edited>\s*$/i, '')
    .replace(/\u200e?(?:image|video|audio|sticker|gif|document|contact card)s? omitted/gi, '');
  t = t.replace(WA_LINK, '[link]').replace(EMAIL, '[email]').replace(MENTION, '[member]').replace(PHONE, '[number]');
  t = scrub(t);
  t = t.replace(MARKS, '').trim();
  // The app's own check is the last word. Anything it still flags loses the whole message.
  return containsContact(t) ? '' : t;
}

export function redactMessages(messages: RawMessage[], key: Buffer): { kept: RedactedMessage[]; dropped: Record<DropReason, number> } {
  const dropped = {} as Record<DropReason, number>;
  const drop = (r: DropReason) => { dropped[r] = (dropped[r] ?? 0) + 1; };
  const scrub = nameScrubber(messages.map((m) => m.sender).filter((s): s is string => !!s), messages.map((m) => m.text));
  const kept: RedactedMessage[] = [];
  for (const m of messages) {
    if (!m.sender) { drop('no_sender'); continue; }
    const reason = systemReason(m.text);
    if (reason) { drop(reason); continue; }
    const text = redactText(m.text, scrub);
    if (!text) { drop(m.text.trim() ? 'contact_guard' : 'empty'); continue; }
    kept.push({ date: m.date, senderId: senderId(key, m.sender), text });
  }
  return { kept, dropped };
}

function loadKey(): Buffer {
  if (!existsSync(HMAC_KEY_FILE)) writeFileSync(HMAC_KEY_FILE, randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(readFileSync(HMAC_KEY_FILE, 'utf8').trim(), 'hex');
}

if (isMain(import.meta.url)) {
  const messages = JSON.parse(readFileSync(MESSAGES_JSON, 'utf8')) as RawMessage[];
  const { kept, dropped } = redactMessages(messages, loadKey());
  ensureWorkDir();
  writeFileSync(REDACTED_JSON, JSON.stringify(kept, null, 1), { mode: 0o600 });
  const stats: RedactStats = { parsed: messages.length, kept: kept.length, senders: new Set(kept.map((m) => m.senderId)).size, dropped };
  writeFileSync(STATS_JSON, JSON.stringify(stats), { mode: 0o600 });
  console.log(`Read ${messages.length}, kept ${kept.length}, senders ${new Set(kept.map((m) => m.senderId)).size}.`);
  console.log('Dropped:', JSON.stringify(dropped));
}
