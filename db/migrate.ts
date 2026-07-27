import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client";

await migrate(db, { migrationsFolder: "./db/migrations" });
console.log("마이그레이션 완료");
await pool.end();
