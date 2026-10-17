// Contact detail rejection for member free text (spec hard rule 6).
// Only a service owner may publish contact details, and only in structured fields.
import { fail } from './http.js';

export function containsContact(text: string): boolean {
  const normalized = text.normalize('NFKC').replace(/\p{Cf}/gu, '')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
    .replace(/\s*(?:\[at\]|\(at\)|\sat\s)\s*/gi, '@')
    .replace(/\s*(?:\[dot\]|\(dot\)|\sdot\s)\s*/gi, '.');
  return /[\w.+-]+\s*@\s*[\w.-]+\s*\.\s*[a-z]{2,}|(?:\+?\d[\s().-]*){8,}/i.test(normalized);
}

/** Throw a 400 when any of the given texts holds a phone number or email address. */
export function rejectContact(...texts: (string | null | undefined)[]): void {
  if (texts.some((t) => t && containsContact(t))) {
    fail(400, 'Please remove phone numbers and email addresses. Services can add contact details on their own listing.', 'contact_details');
  }
}
