import "dotenv/config";
import { db, pool } from "./client";
import { orgs } from "./schema";
import { closeDuePeriods } from "./close";
import { now } from "@/lib/clock";

/**
 * 유예기간이 지난 정산기간을 마감한다. 배치로 매일 한 번 돌리면 된다.
 *
 *   npm run db:close-periods            (기준: 현재 시각)
 *   npm run db:close-periods 2026-08-05 (기준 날짜 지정)
 */

const arg = process.argv[2];
const asOf = arg ? new Date(`${arg}T23:59:00+09:00`) : now();
if (Number.isNaN(asOf.getTime())) {
  throw new Error(`날짜를 읽을 수 없습니다: ${arg}`);
}

console.log(`기준 시각: ${asOf.toISOString()}`);

for (const org of await db.select().from(orgs)) {
  const closed = await closeDuePeriods(org.id, asOf);
  if (closed.length === 0) {
    console.log(`${org.name}: 마감할 기간이 없습니다`);
    continue;
  }
  for (const c of closed) {
    console.log(
      `${org.name}: ${c.periodStart} ~ ${c.periodEnd} 마감 · 스냅샷 ${c.snapshots}명`,
    );
  }
}

await pool.end();
