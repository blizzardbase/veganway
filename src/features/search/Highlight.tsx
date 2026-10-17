// Marks the words of the query inside a text. Builds React nodes; never injects HTML.
import type { ReactNode } from 'react';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0).slice(0, 8);
  if (!words.length) return text;
  const re = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'giu');
  const parts = text.split(re);
  return parts.map((p, i) =>
    i % 2 === 1 ? <mark key={i} className="rounded-sm bg-saffron/40 px-0.5 text-ink">{p}</mark> : p);
}
