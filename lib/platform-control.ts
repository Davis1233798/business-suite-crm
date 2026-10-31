const operations = new Map([["status", "GET"], ["plan", "POST"], ["apply", "POST"]]);

/** Forward only the operator credential, never the switchable demonstration cookie. */
export async function proxyPlatformControl(request: Request, controlUrl?: string): Promise<Response> {
  const operation = new URL(request.url).pathname.slice("/api/platform/control/".length);
  const method = operations.get(operation);
  if (!method) return Response.json({ error: "Unknown operation" }, { status: 404 });
  if (request.method !== method) return Response.json({ error: "Method not allowed" }, { status: 405, headers: { Allow: method } });
  if (!controlUrl) return Response.json({ error: "Control service not configured" }, { status: 503 });
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return Response.json({ error: "Operator authentication required" }, { status: 401 });
  let body: string | undefined;
  if (method === "POST") {
    body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 16384) return Response.json({ error: "Request too large" }, { status: 413 });
  }
  try {
    const response = await fetch(`${controlUrl.replace(/\/$/, "")}/${operation}`, {
      method, body,
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(operation === "apply" ? 120_000 : 15_000),
    });
    return new Response(await response.text(), { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Control connection interrupted; refresh service status before retrying" }, { status: 503 });
  }
}
