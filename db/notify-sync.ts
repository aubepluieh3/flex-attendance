import "dotenv/config";
import { db, pool } from "./client";
import { orgs } from "./schema";
import { syncNotifications } from "./notify";
import { now } from "@/lib/clock";

/**
 * 알림 동기화 배치. 하루 한 번 돌리면 마감 임박 알림이 제때 나간다.
 *
 *   npm run db:notify [YYYY-MM-DD]
 */
const arg = process.argv[2];
const asOf = arg ? new Date(`${arg}T09:00:00+09:00`) : now();
if (Number.isNaN(asOf.getTime())) throw new Error(`날짜를 읽을 수 없습니다: ${arg}`);

console.log(`기준 시각: ${asOf.toISOString()}`);
for (const org of await db.select().from(orgs)) {
  const r = await syncNotifications(org.id, asOf);
  console.log(`${org.name}: 생성 ${r.created} · 해소 ${r.resolved}`);
}
await pool.end();
