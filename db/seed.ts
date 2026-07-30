import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "./client";
import {
  accessLogs,
  attendanceLogs,
  errorLogs,
  dayAdjustments,
  holidays,
  importBatches,
  loginAttempts,
  notifications,
  orgs,
  periodCloseEvents,
  periodSnapshots,
  sessions,
  settlementPeriods,
  teams,
  timeOff,
  users,
  workDays,
  workSessions,
} from "./schema";
import { recomputeWorkDays } from "./recompute";
import { syncNotifications } from "./notify";
import { hashPassword } from "@/lib/password";
import {
  DEMO_PASSWORD,
  demoAttendanceRules,
  demoEmploymentFor,
  demoPeople,
  demoPeriods,
  demoSessionsFor,
  demoTagsFor,
  demoTimeOffFor,
} from "@/lib/seed";
import { deductFor } from "./timeoff";
import { now } from "@/lib/clock";

/**
 * 개발용 시드.
 *
 * 태그 원본만 넣고 work_days 는 recomputeWorkDays 로 만든다 — 시드와 운영이
 * 같은 경로를 타야 어긋나지 않는다.
 *
 * 날짜는 실제 오늘 기준 상대값이다. 고정 날짜를 쓰면 화면이 고장 난 것처럼
 * 보인다.
 */

async function reset() {
  // FK 순서대로 비운다
  await db.delete(notifications);
  await db.delete(loginAttempts);
  // users 를 참조하므로 사용자보다 먼저 지워야 한다
  await db.delete(errorLogs);
  await db.delete(sessions);
  await db.delete(accessLogs);
  await db.delete(periodSnapshots);
  await db.delete(periodCloseEvents);
  await db.delete(settlementPeriods);
  await db.delete(timeOff);
  await db.delete(dayAdjustments);
  await db.delete(workDays);
  await db.delete(workSessions);
  await db.delete(attendanceLogs);
  await db.delete(importBatches);
  await db.delete(users);
  await db.delete(teams);
  await db.delete(holidays);
  await db.delete(orgs);
}

async function main() {
  await reset();
  const asOf = now();
  const { today, current, last, twoAgo } = demoPeriods(asOf);
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const a = demoAttendanceRules;
  const [org] = await db
    .insert(orgs)
    .values({
      name: "FORCS",
      timezone: a.timezone,
      /* 월 단위 — docs/concepts.md 부록과 같다. lib/seed.ts 의 opts 도 월이다 */
      settlementPeriod: "month",
      weekStartDay: 1,
      targetMinutesPerPeriod: 40 * 60,
      limitMinutesPerWeek: 52 * 60,
      standardMinutesPerDay: 8 * 60,
      autoBreakRules: a.autoBreakRules,
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

  const [hq] = await db
    .insert(teams)
    .values({ orgId: org.id, name: "플랫폼본부" })
    .returning();
  const [squad] = await db
    .insert(teams)
    .values({ orgId: org.id, name: "플랫폼팀", parentId: hq.id })
    .returning();

  /* 입·퇴사일이 있는 사람만 값이 들어간다. 없으면 null — 조직 기간 전체가 그 사람의 기간이다 */
  const employment = new Map(
    demoEmploymentFor(asOf).map((e) => [e.employeeNo, e]),
  );
  await db.insert(users).values(
    demoPeople.map((p) => ({
      orgId: org.id,
      name: p.name,
      employeeNo: p.employeeNo,
      teamId: p.team === "hq" ? hq.id : squad.id,
      role: p.role,
      passwordHash,
      hiredAt: employment.get(p.employeeNo)?.hiredAt ?? null,
      resignedAt: employment.get(p.employeeNo)?.resignedAt ?? null,
    })),
  );

  const people = await db
    .select({ id: users.id, employeeNo: users.employeeNo, name: users.name })
    .from(users)
    .where(eq(users.orgId, org.id));
  const idByNo = new Map(people.map((p) => [p.employeeNo, p]));

  let tagCount = 0;
  for (const { employeeNo, tags } of demoTagsFor(asOf)) {
    const user = idByNo.get(employeeNo);
    if (!user || tags.length === 0) continue;
    await db.insert(attendanceLogs).values(
      tags.map((tag) => ({
        orgId: org.id,
        userId: user.id,
        occurredAt: tag.occurredAt,
        direction: tag.direction ?? ("unknown" as const),
        // device_label 은 NOT NULL (NULL 이면 중복 방지 인덱스가 안 걸린다)
        deviceLabel: tag.deviceLabel ?? "",
        source: "import" as const,
      })),
    );
    tagCount += tags.length;
  }

  // 앱에서 직접 찍은 구간 — 나눠 근무 / 종료 깜빡한 경우를 화면에서 볼 수 있게
  let sessionCount = 0;
  for (const s of demoSessionsFor(asOf)) {
    const user = idByNo.get(s.employeeNo);
    if (!user) continue;
    await db.insert(workSessions).values({
      orgId: org.id,
      userId: user.id,
      workDate: s.workDate,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      source: s.source,
      closedManually: s.closedManually,
      closedNote: s.closedNote,
    });
    sessionCount += 1;
  }

  // 휴가 — 승인 대기 1건과 승인된 반차 1건
  const hr = people.find((p) => p.employeeNo === "F2014-002");
  let offCount = 0;
  for (const o of demoTimeOffFor(asOf)) {
    const user = idByNo.get(o.employeeNo);
    if (!user) continue;
    const approved = o.status === "approved";
    await db.insert(timeOff).values({
      orgId: org.id,
      userId: user.id,
      date: o.date,
      kind: o.kind,
      deductMinutes: deductFor(o.kind, org.standardMinutesPerDay),
      reason: o.reason,
      status: o.status,
      requestedBy: user.id,
      decidedBy: approved ? (hr?.id ?? user.id) : null,
      decidedAt: approved ? asOf : null,
      createdBy: user.id,
    });
    offCount += 1;
  }

  for (const range of [twoAgo, last, current]) {
    await db.insert(settlementPeriods).values({
      orgId: org.id,
      periodStart: range.start,
      periodEnd: range.end,
      status: "open",
    });
  }

  let dayRows = 0;
  for (const p of people) {
    const days = await recomputeWorkDays({
      orgId: org.id,
      userId: p.id,
      from: twoAgo.start,
      to: current.end,
      rules: a,
    });
    dayRows += days.length;
  }

  await syncNotifications(org.id, asOf);

  console.log(`오늘: ${today}`);
  console.log(`정산기간: ${twoAgo.start} ~ ${current.end} (기간 3개)`);
  console.log(
    `사용자 ${demoPeople.length}명 · 태그 ${tagCount}건 · 앱 근무구간 ${sessionCount}건 · 휴가 ${offCount}건 · work_days ${dayRows}건`,
  );
  console.log(`로그인 비밀번호: ${DEMO_PASSWORD}`);
  for (const p of demoPeople) {
    console.log(`  ${p.employeeNo}  ${p.name.padEnd(4)} ${p.role}`);
  }
}

await main();
await pool.end();
