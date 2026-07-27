import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL이 없습니다. .env.example 을 .env 로 복사하세요.");
}

// 개발 중 HMR로 풀이 계속 새로 생기는 걸 막는다
const globalForDb = globalThis as unknown as { __flexPool?: Pool };

const pool =
  globalForDb.__flexPool ??
  new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV !== "production") globalForDb.__flexPool = pool;

export const db = drizzle(pool, { schema });
export { pool };
