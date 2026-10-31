import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import * as schema from "./schema";
const requestDatabase = new AsyncLocalStorage<{ binding: any }>();
let customDb: any;
export function runWithDatabase<T>(binding: unknown, run: () => T): T { return requestDatabase.run({ binding }, run); }
export function setCustomD1(binding: any) { customDb = drizzle(binding, { schema }); }
export function getDb(): DrizzleD1Database<typeof schema> {
  const request = requestDatabase.getStore();
  if (request) {
    if (!request.binding) throw new Error("D1 database binding DB is unavailable.");
    return drizzle(request.binding, { schema });
  }
  if (customDb) return customDb;
  if (typeof process !== "undefined" && process.release?.name === "node") {
    const require = createRequire(import.meta.url);
    customDb = drizzle(require("../lib/db/sqlite-d1").getLocalSqliteD1(), { schema });
    return customDb;
  }
  throw new Error("D1 database binding DB is unavailable.");
}
export { schema };
