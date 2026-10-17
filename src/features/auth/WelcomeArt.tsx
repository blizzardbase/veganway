// The Welcome illustration: a bowl of greens under a saffron sun, with a chickpea and a loose leaf.
// Inline SVG in theme colours only, so it costs no request and follows light and dark.

/** One leaf, pointing right from the origin, 80 by 36. */
const LEAF = 'M0 0 C 18 -20, 56 -22, 80 0 C 56 22, 18 20, 0 0 Z';

export function WelcomeArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 200" role="img" aria-label="A bowl of greens and chickpeas under a saffron sun" className={className}>
      {/* Soft ground */}
      <ellipse cx="160" cy="112" rx="150" ry="84" className="fill-brand-soft" />

      {/* Saffron sun with short rays */}
      <g transform="translate(244 58)">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <rect key={a} x="-3" y="-46" width="6" height="12" rx="3" transform={`rotate(${a})`} className="fill-saffron" opacity="0.75" />
        ))}
        <circle r="28" className="fill-saffron" />
        <circle cx="-8" cy="-8" r="9" fill="#fff" opacity="0.3" />
      </g>

      {/* Greens rising out of the bowl */}
      <g>
        <path d={LEAF} transform="translate(110 118) rotate(-62) scale(1.05)" className="fill-on-mono-sage" />
        <path d={LEAF} transform="translate(134 116) rotate(-88) scale(1.15)" className="fill-brand" />
        <path d={LEAF} transform="translate(160 116) rotate(-112) scale(1.0)" className="fill-on-mono-basil" />
        <path d={LEAF} transform="translate(176 118) rotate(-70) scale(0.95)" className="fill-mono-basil-2" />
        <path d={LEAF} transform="translate(196 120) rotate(-128) scale(0.9)" className="fill-on-mono-sage" />
        {/* Chickpeas piled on the greens */}
        {[[140, 106, 9], [158, 100, 8.5], [176, 106, 8], [150, 113, 7.5], [168, 113, 7.5]].map(([cx, cy, r]) => (
          <g key={`${cx}-${cy}`}>
            <circle cx={cx} cy={cy} r={r} className="fill-saffron" />
            <circle cx={cx - r / 3} cy={cy - r / 3} r={r / 3} fill="#fff" opacity="0.5" />
          </g>
        ))}
      </g>

      {/* The bowl */}
      <path d="M72 122 H248 A88 64 0 0 1 72 122 Z" className="fill-brand" />
      <path d="M86 146 H234" className="stroke-saffron" strokeWidth="6" strokeLinecap="round" />
      <ellipse cx="160" cy="122" rx="90" ry="9" className="fill-on-mono-basil" />
      <ellipse cx="160" cy="121" rx="84" ry="6" className="fill-mono-basil-2" />

      {/* A loose leaf and a chickpea on the ground */}
      <g transform="translate(40 168) rotate(-18)">
        <path d={LEAF} transform="scale(0.62)" className="fill-on-mono-sage" />
        <path d="M2 0 H46" className="stroke-brand-soft" strokeWidth="2" strokeLinecap="round" />
      </g>
      <circle cx="268" cy="176" r="7.5" className="fill-saffron" />
      <circle cx="265.5" cy="173.5" r="2.5" fill="#fff" opacity="0.5" />
      <circle cx="284" cy="170" r="6" className="fill-saffron" />
    </svg>
  );
}
