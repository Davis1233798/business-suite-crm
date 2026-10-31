import { getDb } from "../db/index";
import { auditEvents } from "../db/schema";
import { TenantContext } from "./tenant";

export interface LogAuditParams {
  context: TenantContext;
  action: string;
  entityType: string;
  entityId: string;
  beforeValue?: any;
  afterValue?: any;
  reason?: string;
}

/**
 * Records an immutable audit log entry into audit_events (C03).
 */
export async function recordAuditEvent(params: LogAuditParams) {
  const { context, action, entityType, entityId, beforeValue, afterValue, reason } = params;
  const db = getDb();

  const eventId = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  await db.insert(auditEvents).values({
    id: eventId,
    organizationId: context.organizationId,
    actorId: context.userId,
    actorRole: context.role,
    action,
    entityType,
    entityId,
    beforeValue: beforeValue !== undefined ? JSON.stringify(beforeValue) : null,
    afterValue: afterValue !== undefined ? JSON.stringify(afterValue) : null,
    reason: reason || null,
    requestId: context.requestId,
  });

  return eventId;
}
