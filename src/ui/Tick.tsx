import type { ReactNode } from 'react';

/** Animate only the changed value, leaving its accessible text and layout intact. */
export function Tick({ value, children }: { value: number; children?: ReactNode }) {
  return <span key={value} className="count-tick tabular-nums">{children ?? value}</span>;
}
