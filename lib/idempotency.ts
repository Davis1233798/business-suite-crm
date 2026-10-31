import { eq, and } from "drizzle-orm";
import { getDb } from "../db/index";
import { idempotencyKeys } from "../db/schema";
import { TenantContext } from "./tenant";

export interface IdempotencyCheckResult {
  isDuplicate: boolean;
  cachedResponse?: any;
}

/**
 * Checks if the request with given idempotency key was already processed (C06).
 */
export async function checkIdempotency(
  context: TenantContext,
  key: string,
  endpoint: string
): Promise<IdempotencyCheckResult> {
  if (!key) {
    return { isDuplicate: false };
  }

  const db = getDb();
  const existing = await db
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.organizationId, context.organizationId),
        eq(idempotencyKeys.key, key),
        eq(idempotencyKeys.endpoint, endpoint)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    const record = existing[0];
    const parsedBody = JSON.parse(record.responseBody);
    return {
      isDuplicate: true,
      cachedResponse: parsedBody,
    };
  }

  return { isDuplicate: false };
}

/**
 * Saves the response for a successfully processed idempotency key.
 */
export async function saveIdempotency(
  context: TenantContext,
  key: string,
  endpoint: string,
  responseStatus: number,
  responseBody: any
) {
  if (!key) return;

  const db = getDb();
  const id = `idem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  await db.insert(idempotencyKeys).values({
    id,
    organizationId: context.organizationId,
    key,
    endpoint,
    requestHash: key,
    responseStatus,
    responseBody: JSON.stringify(responseBody),
  });
}
