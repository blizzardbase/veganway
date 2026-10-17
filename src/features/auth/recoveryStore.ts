// Holds a freshly issued recovery code in memory only, between the screen that got it and the
// Recovery screen. Never in history state, storage or the URL. A reload loses it on purpose.
export interface PendingRecovery {
  code: string;
  email: string;
  next: string;
  reason: 'signup' | 'reset';
}

let pending: PendingRecovery | null = null;

export function holdRecovery(p: PendingRecovery): void {
  pending = p;
}

export function peekRecovery(): PendingRecovery | null {
  return pending;
}

export function clearRecovery(): void {
  pending = null;
}
