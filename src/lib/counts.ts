// Count copy, in one place so every screen reads the same.

/** "1 member recommends", "12 members recommend". Callers show nothing at 0. */
export function membersRecommend(n: number): string {
  return n === 1 ? '1 member recommends' : `${n} members recommend`;
}

/** "1 reply", "4 replies", or null at 0 so the caller shows nothing. */
export function replyCount(n: number): string | null {
  if (n < 1) return null;
  return n === 1 ? '1 reply' : `${n} replies`;
}
