import { NextRequest } from "next/server";
export type UserRole = "admin" | "operator" | "readonly";
export interface TenantContext {
  organizationId: string; userId: string; userEmail: string;
  userDisplayName: string; role: UserRole; requestId: string;
}
export const SESSION_COOKIE = "demo_session_id";
export function validSession(value: string | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
// Roles are switchable only within the visitor's own demonstration sandbox.
export function resolveTenantContext(request: NextRequest): TenantContext {
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!validSession(session)) throw new Error("展示工作階段失效，請重新載入頁面");
  const rawRole = request.cookies.get("demo_user_role")?.value;
  const role: UserRole = rawRole === "readonly" || rawRole === "operator" ? rawRole : "admin";
  return {
    organizationId: `org_${session}`, userId: `usr_org_${session}_${role === "operator" ? "op" : role === "readonly" ? "ro" : "admin"}`,
    userEmail: `${role}@suite.test`, userDisplayName: role === "admin" ? "示範管理員" : role === "operator" ? "示範作業員" : "示範訪客（唯讀）",
    role, requestId: crypto.randomUUID(),
  };
}
export function checkPermission(context: TenantContext, requiredRole: "admin" | "operator"): { allowed: boolean; code?: string; message?: string } {
  if (context.role === "readonly") return { allowed: false, code: "FORBIDDEN_READONLY", message: "唯讀角色無權執行修改操作 (403 Forbidden)" };
  if (requiredRole === "admin" && context.role !== "admin") return { allowed: false, code: "FORBIDDEN_ADMIN_REQUIRED", message: "此操作需要管理員權限 (403 Forbidden)" };
  return { allowed: true };
}
