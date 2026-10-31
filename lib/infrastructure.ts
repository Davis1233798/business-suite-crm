import { AsyncLocalStorage } from "node:async_hooks";

export type InfrastructureConfig = { INFRA_GATEWAY_URL?: string; INFRA_GATEWAY_TOKEN?: string };
const configuration = new AsyncLocalStorage<InfrastructureConfig>();
// Only pending fills are retained; Redis owns TTL and cross-process reuse.
const catalogFills = new Map<string, Promise<object[]>>();
export function runWithInfrastructure<T>(config: InfrastructureConfig, run: () => T): T {
  return configuration.run(config, run);
}
export function infrastructureConfigured() {
  const config = configuration.getStore();
  return !!(config?.INFRA_GATEWAY_URL && config?.INFRA_GATEWAY_TOKEN);
}
export async function infrastructureRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const config = configuration.getStore();
  if (!config?.INFRA_GATEWAY_URL || !config.INFRA_GATEWAY_TOKEN) throw new Error("INFRA_NOT_CONFIGURED");
  const response = await fetch(`${config.INFRA_GATEWAY_URL.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.INFRA_GATEWAY_TOKEN}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`INFRA_HTTP_${response.status}`);
  return response.json() as Promise<T>;
}

/** Cache only descriptive catalog rows. Live prices and stock bypass this cache. */
export async function cachedCatalog<T extends object>(tenant: string, params: object, load: () => Promise<T[]>): Promise<T[]> {
  if (!infrastructureConfigured()) return load();
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(params)));
  const key = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
  const path = `/cache/${encodeURIComponent(tenant)}/${key}`;
  const config = configuration.getStore()!;
  const identity = JSON.stringify([config.INFRA_GATEWAY_URL, config.INFRA_GATEWAY_TOKEN, tenant, key]);
  const existing = catalogFills.get(identity);
  if (existing) return existing as Promise<T[]>;
  const fill = async () => {
    try {
      const cached = await infrastructureRequest<{ value: T[] | null }>(path);
      if (Array.isArray(cached.value)) return cached.value;
    } catch { /* Fail open to authoritative D1. */ }
    const value = await load();
    try { await infrastructureRequest(path, { method: "PUT", body: JSON.stringify({ value }) }); } catch { /* Cache is optional. */ }
    return value;
  };
  // Bound coordination memory when many unrelated queries arrive at once.
  if (catalogFills.size >= 512) return fill();
  const pending = fill();
  catalogFills.set(identity, pending);
  try { return await pending; }
  finally { if (catalogFills.get(identity) === pending) catalogFills.delete(identity); }
}
