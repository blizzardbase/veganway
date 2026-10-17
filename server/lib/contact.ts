// Contact detail rejection for member free text (spec hard rule 6).
// Only a service owner may publish contact details, and only in structured fields.
import { fail } from './http.js';

export function containsContact(text: string): boolean {
  const normalized = text.normalize('NFKC').replace(/\p{Cf}/gu, '')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
    .replace(/\s*(?:\[dot\]|\(dot\)|\sdot\s)\s*/gi, '.');
  // Only map coordinates and structured place identifiers bypass the phone rule.
  const withoutMaps = normalized.replace(/https:\/\/[^\s<>"']+/gi, (link) => {
    try {
      const url = new URL(link);
      if (url.username || url.password || url.port) return link;
      const host = url.hostname.toLowerCase();
      const mapsHost = ['maps.google.com', 'maps.app.goo.gl', 'maps.apple.com', 'maps.apple'].includes(host);
      const mapsPath = ['google.com', 'www.google.com', 'google.ae', 'www.google.ae', 'goo.gl'].includes(host)
        && (url.pathname === '/maps' || url.pathname.startsWith('/maps/'));
      if (!mapsHost && !mapsPath) return link;
      let content = `${url.pathname} ${url.search} ${url.hash}`;
      // Decode nested escapes too, so encoding cannot conceal a contact token.
      for (let i = 0; i < 5; i++) {
        const decoded = content.replace(/(?:%[a-f0-9]{2})+/gi, (part) => {
          try { return decodeURIComponent(part); } catch { return part; }
        });
        if (decoded === content) break;
        content = decoded;
      }
      content = content.replace(/\+/g, ' ').normalize('NFKC').replace(/\p{Cf}/gu, '')
        .replace(/\s*(?:\[dot\]|\(dot\)|\sdot\s)\s*/gi, '.')
        .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
        .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0));
      content = content.replace(/(^|[^\w.])@?(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)(?:,\d+(?:\.\d+)?z)?(?=$|[^\w.])/g,
        (match, prefix: string, lat: string, lon: string) => Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180 ? `${prefix} coordinates ` : match);
      content = content.replace(/!(3d|4d)(-?\d{1,3}(?:\.\d+)?)(?=$|[!/?&#\s])/g,
        (match, axis: string, value: string) => Math.abs(Number(value)) <= (axis === '3d' ? 90 : 180) ? ' coordinate ' : match);
      // Check contact tokens before exempting opaque IDs that may contain long digit runs.
      if (hasContact(content, false)) return content;
      content = content.replace(/\b(?:query_place_id=|q=place_id:)(ChI[A-Za-z0-9_-]+)(?=$|[&\s])/g, ' place ')
        .replace(/!1s0x[a-f0-9]+:0x[a-f0-9]+/gi, ' place ')
        .replace(/!16s\/(?:g|m)\/[a-z0-9_-]+(?=$|[!\s])/gi, ' place ');
      if (host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'maps.apple') {
        content = content.replace(/^\/(?:maps\/|p\/)?[a-z0-9_-]+(?=\s)/i, ' place ');
      }
      return content;
    } catch {
      return link;
    }
  });
  return hasContact(withoutMaps);
}

function hasContact(text: string, checkPhone = true): boolean {
  const socialLink = /(?:^|[^\p{L}\p{N}_-])(?:[a-z0-9-]+\.)*(?:instagram\.com|instagr\.am|facebook\.com|fb\.com|fb\.me|m\.me|messenger\.com|tiktok\.com|t\.me|telegram\.me|telegram\.dog|telegram\.org|wa\.me|whatsapp\.com|whatsapp\.net|twitter\.com|x\.com|threads\.net|threads\.com|bsky\.app|snapchat\.com|discord\.gg|discord\.com|signal\.me|signal\.group|linkedin\.com|linktr\.ee|beacons\.ai|bio\.site)(?=$|[^\p{L}\p{N}_-])/iu;
  const handle = /(?:^|[^\p{L}\p{N}_])@[\p{L}\p{N}_][\p{L}\p{N}_.]*/u;
  const plainHandle = /\b(?:instagram|insta|ig|facebook|fb|tiktok|telegram|tg|snapchat|signal|whatsapp|discord|twitter)\s+(?:(?:handle|username)\s*)?(?:-\s*)?@?([a-z0-9_][a-z0-9_.-]*)(?=[.!?]?\s*$)/i;
  const plain = plainHandle.exec(text);
  const hasPlainHandle = plain && !/^(?:is|it|this|that|photos|please|too|yet)$/i.test(plain[1].replace(/\.$/, ''));
  const labelledHandle = /\b(?:instagram|insta|ig|facebook|fb|tiktok|telegram|tg|snapchat|signal|whatsapp|discord|twitter)\s*(?:handle|username)?\s*[:=]\s*@?[a-z0-9_][a-z0-9_.-]*/i;
  return socialLink.test(text.replace(/\s*\.\s*/g, '.')) || handle.test(text) || labelledHandle.test(text) || Boolean(hasPlainHandle)
    || /[\w.+-]+\s*@\s*[\w.-]+\s*\.\s*[a-z]{2,}/i.test(text.replace(/\s*(?:\[at\]|\(at\)|\sat\s)\s*/gi, '@'))
    || (checkPhone && /(?:\+?\d[\s().-]*){8,}/.test(text));
}

/** Throw a 400 when any of the given texts holds contact details. */
export function rejectContact(...texts: (string | null | undefined)[]): void {
  if (texts.some((t) => t && containsContact(t))) {
    fail(400, 'Please remove phone numbers and email addresses. Remove social contact links and handles too. Services can add contact details on their own listing.', 'contact_details');
  }
}
