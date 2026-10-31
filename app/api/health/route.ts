import { successResponse, errorResponse } from "@/lib/api-response";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
export const dynamic = "force-dynamic";
export async function GET() {
  try { await getDb().run(sql`SELECT 1`); return successResponse({ status: "ok", database: "connected", payment: "mock" }); }
  catch { return errorResponse("DATABASE_UNAVAILABLE", "資料庫暫時無法連線", 503); }
}
