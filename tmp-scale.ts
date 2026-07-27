import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "./db/client";
import { orgs, teams, users } from "./db/schema";
import { currentViewer, loadOrgRules } from "./db/access";
import { applyImport } from "./db/import";
import { DateTime } from "luxon";

const hr = await currentViewer("F2014-002");
const rules = await loadOrgRules(hr.orgId);
const [org] = await db.select().from(orgs).where(eq(orgs.id, hr.orgId));

console.log("[1] 팀 12개 · 직원 200명 생성");
const t0 = Date.now();
const [hq] = await db.select().from(teams).where(eq(teams.name, "플랫폼본부"));
const teamIds: string[] = [];
for (let i = 1; i <= 12; i++) {
  const [t] = await db.insert(teams).values({ orgId: org.id, name: `팀${String(i).padStart(2, "0")}`, parentId: hq.id }).returning();
  teamIds.push(t.id);
}
const newUsers = [];
for (let i = 1; i <= 200; i++) {
  newUsers.push({
    orgId: org.id,
    name: `직원${String(i).padStart(3, "0")}`,
    employeeNo: `E${String(i).padStart(4, "0")}`,
    teamId: teamIds[i % 12],
    role: (i % 25 === 0 ? "manager" : "member") as "manager" | "member",
  });
}
await db.insert(users).values(newUsers);
console.log(`  ${Date.now() - t0}ms`);

console.log("\n[2] CSV 생성 — 200명 × 20영업일 × 4태그");
const rows = ["사번,일시,출입구분,단말기"];
let cursor = DateTime.fromISO("2026-06-01", { zone: "Asia/Seoul" });
const days: string[] = [];
while (days.length < 20) {
  if (cursor.weekday <= 5) days.push(cursor.toISODate()!);
  cursor = cursor.plus({ days: 1 });
}
for (const u of newUsers) {
  for (const d of days) {
    const inH = 8 + (Number(u.employeeNo.slice(1)) % 3);
    rows.push(`${u.employeeNo},${d} ${String(inH).padStart(2,"0")}:${String(Number(u.employeeNo.slice(1)) % 60).padStart(2,"0")}:00,입장,본사`);
    rows.push(`${u.employeeNo},${d} 12:05:00,퇴장,본사`);
    rows.push(`${u.employeeNo},${d} 13:02:00,입장,본사`);
    rows.push(`${u.employeeNo},${d} ${String(inH + 10).padStart(2,"0")}:15:00,퇴장,본사`);
  }
}
const csv = rows.join("\n");
console.log(`  ${rows.length - 1}행 · ${(csv.length / 1024 / 1024).toFixed(1)}MB`);

console.log("\n[3] 임포트 + 재계산");
const t1 = Date.now();
const report = await applyImport({
  viewer: hr, fileName: "bulk200.csv", text: csv,
  mapping: { employeeNo: "사번", timestamp: "일시", direction: "출입구분", deviceLabel: "단말기" },
});
const ms = Date.now() - t1;
console.log(`  ${ms}ms · 반영 ${report.inserted} · 중복 ${report.duplicates} · 오류 ${report.errors.length} · 재계산 대상 ${report.recomputed.length}명`);
console.log(`  행당 ${(ms / (rows.length - 1)).toFixed(2)}ms`);

const [{ c: logs }] = await db.select({ c: sql<number>`count(*)::int` }).from(sql`attendance_logs`);
const [{ c: wd }] = await db.select({ c: sql<number>`count(*)::int` }).from(sql`work_days`);
console.log(`  attendance_logs ${logs}행 · work_days ${wd}행`);

await pool.end();
