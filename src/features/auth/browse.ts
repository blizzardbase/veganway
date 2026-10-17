// Remembers that a signed out visitor chose to look around, so Home stops sending them to Welcome.
const KEY = 'vw-browse';

export function markBrowsing(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // Storage blocked: they see Welcome again next visit.
  }
}

export function isBrowsing(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
