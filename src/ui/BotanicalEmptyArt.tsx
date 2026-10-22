/** Small local illustrations. The surrounding message supplies the accessible meaning. */
export function BotanicalEmptyArt({ kind }: { kind: 'search' | 'saved' | 'posts' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 96 80" className="h-20 w-24 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="47" cy="42" rx="42" ry="30" className="fill-surface-2" stroke="none" />
      <path d="M10 57 Q9 41 22 40 Q25 53 10 57 M74 26 Q72 12 85 12 Q88 22 74 26" fill="currentColor" opacity=".3" stroke="none" />
      <circle cx="76" cy="61" r="4" className="fill-saffron" stroke="none" />
      {kind === 'search' ? <><circle cx="43" cy="35" r="17" /><path d="m56 48 15 15 M36 41 Q33 28 48 28 Q50 40 36 41 M37 41 l9-10" /></>
        : kind === 'saved' ? <><path d="M31 17 h31 v47 L46 54 31 64Z" className="fill-surface" /><path d="M46 46 V31 M46 37 Q34 37 36 27 Q46 26 46 37 M46 32 Q46 21 56 23 Q58 32 46 32" /></>
        : <><path d="M27 48 H66 L61 66 H32Z" className="fill-surface" /><path d="M46 48 V25 M46 38 Q30 40 31 25 Q45 23 46 38 M46 31 Q46 15 61 18 Q62 31 46 31" /><path d="M24 49 H69" /></>}
      <path d="M15 68 H77" opacity=".25" />
    </svg>
  );
}
