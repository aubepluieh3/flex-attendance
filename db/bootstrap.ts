import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "./client";
import { orgs, teams, users } from "./schema";
import { generateTempPassword } from "./people";
import { hashPassword } from "@/lib/password";
import { demoAttendanceRules } from "@/lib/seed";

/**
 * 실제 도입용 초기 설정 (CLI 전용).
 *
 *   npm run db:bootstrap -- "회사명" "본부명" F2014-002 "정세아"
 *
 * db:seed 는 데모 데이터를 넣는 것이라 실제 회사에 쓸 수 없다. 이건 org 하나와
 * 팀 하나, 첫 HR 한 명만 만든다. 나머지는 화면에서 한다.
 *
 * 화면으로 만들지 않는 이유: "org 가 없을 때만 열리는 첫 HR 생성 창"이 필요하고,
 * 그 조건이 무너지면(org 를 실수로 지우면) 누구나 HR 이 될 수 있다. 설치하는
 * 사람은 서버 권한이 있으니 CLI 가 맞다.
 *
 * 근태 규칙은 기본값으로 넣는다. 코어타임·휴게·상한은 서면합의 사항이라
 * 회사가 근태 설정 화면에서 직접 맞춰야 한다.
 */

const [orgName, teamName, employeeNo, personName] = process.argv
  .slice(2)
  .map((s) => s?.trim());

if (!orgName || !teamName || !employeeNo || !personName) {
  console.error(
    '사용법: npm run db:bootstrap -- "회사명" "팀명" <사번> "이름"',
  );
  console.error('예:     npm run db:bootstrap -- "FORCS" "플랫폼본부" F2014-002 "정세아"');
  process.exit(1);
}

const existing = await db.select({ id: orgs.id, name: orgs.name }).from(orgs);
if (existing.length > 0) {
  console.error(
    `이미 조직이 있습니다: ${existing.map((o) => o.name).join(", ")}`,
  );
  console.error(
    "사용자 추가는 화면(사용자 관리)에서 하세요. 처음부터 다시 만들려면",
  );
  console.error("데이터를 백업(npm run db:dump)한 뒤 db:reset:force 를 쓰세요.");
  await pool.end();
  process.exit(1);
}

const a = demoAttendanceRules;
const [org] = await db
  .insert(orgs)
  .values({
    name: orgName,
    timezone: a.timezone,
    settlementPeriod: "month",
    weekStartDay: 1,
    targetMinutesPerPeriod: 160 * 60,
    limitMinutesPerWeek: 52 * 60,
    standardMinutesPerDay: 8 * 60,
    breakRules: a.breakRules,
    dayBoundaryHour: a.dayBoundaryHour,
    coreTimeStart: a.coreTime?.start,
    coreTimeEnd: a.coreTime?.end,
    flexBandStart: a.flexBand?.start,
    flexBandEnd: a.flexBand?.end,
    nightWindowStart: a.nightWindow.start,
    nightWindowEnd: a.nightWindow.end,
    dailyLimitMinutes: a.dailyLimitMinutes,
    weekendDays: a.weekendDays,
  })
  .returning();

const [team] = await db
  .insert(teams)
  .values({ orgId: org.id, name: teamName })
  .returning();

const temp = generateTempPassword();
await db.insert(users).values({
  orgId: org.id,
  teamId: team.id,
  name: personName,
  employeeNo,
  role: "hr",
  passwordHash: await hashPassword(temp),
});

console.log(`조직 ${org.name} · 팀 ${team.name}`);
console.log(`첫 HR  ${personName} (${employeeNo})`);
console.log(`임시 비밀번호: ${temp}`);
console.log("");
console.log("다음 순서:");
console.log("  1. 로그인 후 내 계정에서 비밀번호 변경");
console.log("  2. 근태 설정에서 정산기간·코어타임·휴게·상한을 회사 서면합의에 맞춘다");
console.log("     (기본값은 예시일 뿐이다 — 그대로 쓰면 안 된다)");
console.log("  3. 사용자 관리에서 구성원 추가");
console.log("  4. 근태 파일 반영에서 첫 CSV 올리기");

await pool.end();
