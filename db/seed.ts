import "dotenv/config";
import { db, pool } from "./client";
import {
  accessLogs,
  attendanceLogs,
  dayAdjustments,
  holidays,
  importBatches,
  orgs,
  periodCloseEvents,
  periodSnapshots,
  settlementPeriods,
  teams,
  timeOff,
  users,
  workDays,
} from "./schema";
import { recomputeWorkDays } from "./recompute";
import { hashPassword } from "@/lib/password";
import {
  demoAttendanceRules,
  demoEmployee,
  demoPeriod,
  demoTags,
} from "@/lib/seed";

/**
 * 개발용 시드. 화면을 실제 DB로 돌리기 위한 최소 데이터.
 *
 * 태그 원본만 넣고 work_days는 recomputeWorkDays로 만든다 — 실제 임포트와
 * 같은 경로를 타야 시드와 운영이 어긋나지 않는다.
 */

async function reset() {
  // FK 순서대로 비운다
  await db.delete(accessLogs);
  await db.delete(periodSnapshots);
  await db.delete(periodCloseEvents);
  await db.delete(settlementPeriods);
  await db.delete(timeOff);
  await db.delete(dayAdjustments);
  await db.delete(workDays);
  await db.delete(attendanceLogs);
  await db.delete(importBatches);
  await db.delete(users);
  await db.delete(teams);
  await db.delete(holidays);
  await db.delete(orgs);
}

const DEMO_PASSWORD = "flex-demo-1234";

async function main() {
  await reset();
  // 개발용 공통 비밀번호. 운영에서는 초대 메일이나 SSO 로 대체한다.
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const [org] = await db
    .insert(orgs)
    .values({
      name: "FORCS",
      timezone: demoAttendanceRules.timezone,
      settlementPeriod: "week",
      weekStartDay: 1,
      targetMinutesPerPeriod: 40 * 60,
      limitMinutesPerWeek: 52 * 60,
      standardMinutesPerDay: 8 * 60,
      breakRules: demoAttendanceRules.breakRules,
      dayBoundaryHour: demoAttendanceRules.dayBoundaryHour,
      coreTimeStart: demoAttendanceRules.coreTime?.start,
      coreTimeEnd: demoAttendanceRules.coreTime?.end,
      flexBandStart: demoAttendanceRules.flexBand?.start,
      flexBandEnd: demoAttendanceRules.flexBand?.end,
      nightWindowStart: demoAttendanceRules.nightWindow.start,
      nightWindowEnd: demoAttendanceRules.nightWindow.end,
      dailyLimitMinutes: demoAttendanceRules.dailyLimitMinutes,
      weekendDays: demoAttendanceRules.weekendDays,
    })
    .returning();

  const [platform] = await db
    .insert(teams)
    .values({ orgId: org.id, name: "플랫폼본부" })
    .returning();
  const [squad] = await db
    .insert(teams)
    .values({ orgId: org.id, name: demoEmployee.team, parentId: platform.id })
    .returning();

  const [member] = await db
    .insert(users)
    .values({
      orgId: org.id,
      name: demoEmployee.name,
      employeeNo: demoEmployee.employeeNo,
      teamId: squad.id,
      role: "member",
      passwordHash,
    })
    .returning();

  await db.insert(users).values([
    {
      orgId: org.id,
      name: "이하람",
      employeeNo: "F2016-008",
      teamId: squad.id,
      role: "manager",
      passwordHash,
    },
    {
      orgId: org.id,
      name: "정세아",
      employeeNo: "F2014-002",
      teamId: platform.id,
      role: "hr",
      passwordHash,
    },
  ]);

  await db.insert(attendanceLogs).values(
    demoTags.map((tag) => ({
      orgId: org.id,
      userId: member.id,
      occurredAt: tag.occurredAt,
      direction: tag.direction ?? "unknown",
      // device_label 은 NOT NULL 이다 (NULL 이면 중복 방지 인덱스가 안 걸린다)
      deviceLabel: tag.deviceLabel ?? "",
      source: "import" as const,
    })),
  );

  await db.insert(settlementPeriods).values({
    orgId: org.id,
    periodStart: demoPeriod.start,
    periodEnd: demoPeriod.end,
    status: "open",
  });

  const days = await recomputeWorkDays({
    orgId: org.id,
    userId: member.id,
    from: demoPeriod.start,
    to: demoPeriod.end,
    rules: demoAttendanceRules,
  });

  console.log(`로그인 비밀번호: ${DEMO_PASSWORD}`);
  console.log(`org ${org.name} · 사용자 3명 · 태그 ${demoTags.length}건`);
  console.log(`work_days ${days.length}건 생성`);
  for (const d of days) {
    console.log(
      `  ${d.workDate} ${d.status.padEnd(10)} 실근무 ${String(d.workMinutes).padStart(3)}분` +
        (d.flags.length ? ` · ${d.flags.join(",")}` : ""),
    );
  }
}

await main();
await pool.end();
