import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "./client";
import { accessLogs, teams, users } from "./schema";
import { assertCanReadDetail, loadWorkDays, type Viewer } from "./access";

/**
 * 권한 게이트 검증. 살아 있는 DB가 필요해서 단위 테스트로 두지 않았다.
 * 권한 회귀는 제일 위험한 종류의 버그라서 확인 경로를 남겨둔다.
 *
 *   npm run db:seed && npm run db:check-access
 */

const rows = await db
  .select({
    id: users.id,
    orgId: users.orgId,
    name: users.name,
    role: users.role,
    teamId: users.teamId,
    teamName: teams.name,
  })
  .from(users)
  .leftJoin(teams, eq(users.teamId, teams.id));

const member = rows.find((r) => r.role === "member");
const manager = rows.find((r) => r.role === "manager");
const hr = rows.find((r) => r.role === "hr");

if (!member || !manager || !hr) {
  throw new Error("시드 데이터가 없습니다. npm run db:seed 를 먼저 실행하세요.");
}

// 임원과 상위팀 팀장은 시드에 없으므로 역할만 바꿔 구성한다.
// 임원은 member와 다른 사람이어야 한다 — 같은 id면 "본인 조회"로 통과해서
// 검사가 무의미해진다.
const executive: Viewer = { ...hr, role: "executive" };
const parentManager: Viewer = {
  ...manager,
  role: "manager",
  teamId: hr.teamId,
  teamName: hr.teamName,
};

let failed = 0;

async function check(
  name: string,
  expect: "allow" | "deny",
  fn: () => Promise<unknown>,
) {
  let denied: string | null = null;
  try {
    await fn();
  } catch (e) {
    denied = (e as Error).message;
  }

  const ok = expect === "allow" ? denied === null : denied !== null;
  if (!ok) failed += 1;
  const mark = ok ? "✓" : "✗";
  const tail = denied ? ` — ${denied}` : "";
  console.log(`${mark} ${name} (${expect})${tail}`);
}

const range = { start: "2026-07-20", end: "2026-07-26" };

await check("사원이 본인 기록", "allow", () =>
  assertCanReadDetail(member, member.id),
);
await check("사원이 타인 기록", "deny", () =>
  assertCanReadDetail(member, manager.id),
);
await check("팀장이 같은 팀원 기록", "allow", () =>
  assertCanReadDetail(manager, member.id),
);
await check("상위 팀 팀장이 하위 팀원 기록", "allow", () =>
  assertCanReadDetail(parentManager, member.id),
);
await check("HR이 전사 기록", "allow", () =>
  assertCanReadDetail(hr, member.id),
);
await check("임원이 타인 개인 상세", "deny", () =>
  assertCanReadDetail(executive, member.id),
);
// 역할과 무관하게 본인 기록은 볼 수 있어야 한다
await check("임원이 본인 기록", "allow", () =>
  assertCanReadDetail(executive, executive.id),
);

const before = (await db.select().from(accessLogs)).length;
await loadWorkDays(member, member.id, range);
const afterSelf = (await db.select().from(accessLogs)).length;
await loadWorkDays(manager, member.id, range);
const afterOther = (await db.select().from(accessLogs)).length;

const selfLogged = afterSelf !== before;
const otherLogged = afterOther !== afterSelf;
if (selfLogged || !otherLogged) failed += 1;

console.log(
  `${selfLogged ? "✗" : "✓"} 본인 조회는 열람 로그를 남기지 않음 (${before}→${afterSelf})`,
);
console.log(
  `${otherLogged ? "✓" : "✗"} 타인 조회는 열람 로그를 남김 (${afterSelf}→${afterOther})`,
);

await pool.end();

if (failed > 0) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log("\n권한 게이트 정상");
