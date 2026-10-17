// Append only audit log. Never put an email, IP or user agent in detail.
import type { Queryable } from '../db.js';

export interface AuditEntry {
  /** Acting member id, or null for the command line or the system. */
  actorId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown>;
}

export async function audit(db: Queryable, entry: AuditEntry): Promise<void> {
  await db.query(
    'INSERT INTO audit (actor_id, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5)',
    [entry.actorId, entry.action, entry.targetType ?? null, entry.targetId ?? null, entry.detail ?? {}],
  );
}
