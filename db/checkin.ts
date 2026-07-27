import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "./client";
import { attendanceLogs, workSessions } from "./schema";
import { AccessDenied, loadOrgRules, type Viewer } from "./access";
import { recomputeWorkDays } from "./recompute";
import { syncNotifications } from "./notify";
import { resolveWorkDate } from "@/lib/attendance/compute";
import { sessionsFromTags } from "@/lib/attendance/sessions";
import { resolvePeriod } from "@/lib/attendance/period";
import { isPeriodClosed } from "./close";
import { now } from "@/lib/clock";

/**
 * 앱에서 직접 근무 시작 / 종료.
 *
 * 기획서 1번 기능. 하루에 여러 번 나눠 일하는 경우를 지원하려면 세션을 여러 개
 * 만들 수 있어야 한다 — 그래서 "오늘 한 번"이 아니라 "열린 세션이 없으면 시작".
 *
 * 사원증 기록은 attendance_logs 에 그대로 남고 계산 시점에 세션으로 변환된다.
 * 같은 시간대가 겹치면 계산 단계에서 합쳐지므로 이중 계산은 생기지 않는다.
 */

export type OpenSession = {
  id: string;
  workDate: string;
  startedAt: Date;
};

async function openSessionOf(userId: string): Promise<OpenSession | null> {
  const [row] = await db
    .select({
      id: workSessions.id,
      workDate: workSessions.workDate,
      startedAt: workSessions.startedAt,
    })
    .from(workSessions)
    .where(and(eq(workSessions.userId, userId), isNull(workSessions.endedAt)))
    .orderBy(desc(workSessions.startedAt))
    .limit(1);
  return row ?? null;
}

/** 화면에 보여줄 근무 구간. 사원증에서 유도된 구간은 id 가 없어서 손댈 수 없다. */
export type DisplaySession = {
  id: string | null;
  startedAt: Date;
  endedAt: Date | null;
  source: "app" | "import" | "manual" | "badge";
  closedManually: boolean;
  closedNote: string;
};

/**
 * 정산기간 안의 내 근무 구간 전부, 날짜별로 (기록 화면).
 *
 * 앱 세션만 보여주면 안 된다. 오전은 사원증으로 찍고 저녁은 앱으로 일한 날에
 * 오전 근무가 화면에서 사라진 것처럼 보이고, 그러면 합계와 목록이 어긋난다.
 * 사원증 태그에서 유도되는 구간도 같이 올린다.
 */
export async function sessionsByDate(
  userId: string,
  from: string,
  to: string,
  rules: Awaited<ReturnType<typeof loadOrgRules>>,
): Promise<Map<string, DisplaySession[]>> {
  const zone = rules.attendance.timezone;
  // 자정을 넘긴 근무가 잘리지 않게 앞뒤로 하루씩 넓게 읽는다
  const winFrom = DateTime.fromISO(from, { zone }).minus({ days: 1 }).toJSDate();
  const winTo = DateTime.fromISO(to, { zone }).plus({ days: 2 }).toJSDate();

  const [rows, tags] = await Promise.all([
    db
      .select({
        workDate: workSessions.workDate,
        id: workSessions.id,
        startedAt: workSessions.startedAt,
        endedAt: workSessions.endedAt,
        source: workSessions.source,
        closedManually: workSessions.closedManually,
        closedNote: workSessions.closedNote,
      })
      .from(workSessions)
      .where(
        and(
          eq(workSessions.userId, userId),
          gte(workSessions.workDate, from),
          lte(workSessions.workDate, to),
        ),
      ),
    db
      .select({
        occurredAt: attendanceLogs.occurredAt,
        direction: attendanceLogs.direction,
      })
      .from(attendanceLogs)
      .where(
        and(
          eq(attendanceLogs.userId, userId),
          gte(attendanceLogs.occurredAt, winFrom),
          lte(attendanceLogs.occurredAt, winTo),
        ),
      )
      .orderBy(asc(attendanceLogs.occurredAt)),
  ]);

  const byDate = new Map<string, DisplaySession[]>();
  const put = (workDate: string, s: DisplaySession) => {
    const list = byDate.get(workDate);
    if (list) list.push(s);
    else byDate.set(workDate, [s]);
  };

  for (const { workDate, ...row } of rows) put(workDate, row);

  for (const s of sessionsFromTags(tags, rules.attendance)) {
    const workDate = resolveWorkDate(s.startedAt, rules.attendance);
    if (workDate < from || workDate > to) continue;
    put(workDate, {
      id: null,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      source: "badge",
      closedManually: false,
      closedNote: "",
    });
  }

  for (const list of byDate.values()) {
    list.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  }
  return byDate;
}

async function assertOpenPeriod(orgId: string, workDate: string, rules: Awaited<ReturnType<typeof loadOrgRules>>) {
  const range = resolvePeriod(workDate, {
    kind: rules.settlementKind,
    weekStartDay: rules.weekStartDay,
    timezone: rules.attendance.timezone,
  });
  if (await isPeriodClosed(orgId, range)) {
    throw new AccessDenied(
      `${range.start} ~ ${range.end} 정산기간은 마감되어 기록할 수 없습니다.`,
    );
  }
}

export async function startWork(viewer: Viewer): Promise<{ startedAt: Date }> {
  const rules = await loadOrgRules(viewer.orgId);
  const at = now();
  const workDate = resolveWorkDate(at, rules.attendance);
  await assertOpenPeriod(viewer.orgId, workDate, rules);

  // 같은 사람의 동시 요청을 직렬화한다. 안 하면 열린 세션이 두 개 생긴다.
  const started = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${viewer.id}))`);

    const [existing] = await tx
      .select({ startedAt: workSessions.startedAt })
      .from(workSessions)
      .where(and(eq(workSessions.userId, viewer.id), isNull(workSessions.endedAt)))
      .limit(1);
    if (existing) {
      throw new Error(
        `이미 ${DateTime.fromJSDate(existing.startedAt, { zone: rules.attendance.timezone }).toFormat("HH:mm")}부터 근무 중입니다. 먼저 종료해 주세요.`,
      );
    }

    await tx.insert(workSessions).values({
      orgId: viewer.orgId,
      userId: viewer.id,
      workDate,
      startedAt: at,
      source: "app",
    });
    return at;
  });

  await recomputeWorkDays({
    orgId: viewer.orgId,
    userId: viewer.id,
    from: workDate,
    to: workDate,
    rules: rules.attendance,
    asOf: at,
  });

  return { startedAt: started };
}

export async function stopWork(
  viewer: Viewer,
): Promise<{ workDate: string; minutes: number }> {
  const rules = await loadOrgRules(viewer.orgId);
  const at = now();

  const open = await openSessionOf(viewer.id);
  if (!open) throw new Error("근무 중이 아닙니다. 먼저 근무를 시작해 주세요.");
  await assertOpenPeriod(viewer.orgId, open.workDate, rules);

  if (at.getTime() <= open.startedAt.getTime()) {
    throw new Error("종료 시각이 시작 시각보다 이릅니다.");
  }

  /**
   * 탭이 두 개 열려 있으면 종료 요청이 같이 온다. WHERE 로 한 건만 쓰이는 건
   * 맞지만, 못 쓴 쪽까지 "종료했습니다"라고 답하면 화면이 거짓말을 한다.
   * 실제로 쓴 요청만 성공으로 본다.
   */
  const done = await db
    .update(workSessions)
    .set({ endedAt: at })
    .where(and(eq(workSessions.id, open.id), isNull(workSessions.endedAt)))
    .returning({ id: workSessions.id });

  if (done.length === 0) {
    throw new Error("이미 종료된 근무입니다. 화면을 새로 고쳐 주세요.");
  }

  await recomputeWorkDays({
    orgId: viewer.orgId,
    userId: viewer.id,
    from: open.workDate,
    to: open.workDate,
    rules: rules.attendance,
    asOf: at,
  });

  // 진행 중이던 날이 확정되면서 위반·미완료 상태가 바뀔 수 있다
  await syncNotifications(viewer.orgId, at);

  return {
    workDate: open.workDate,
    minutes: Math.round((at.getTime() - open.startedAt.getTime()) / 60_000),
  };
}

/** 지난 날의 열린 세션 — 체크아웃을 깜빡한 것. 화면에서 보정하도록 안내한다. */
export async function danglingSession(
  userId: string,
  rules: Awaited<ReturnType<typeof loadOrgRules>>,
): Promise<OpenSession | null> {
  const open = await openSessionOf(userId);
  if (!open) return null;
  const today = resolveWorkDate(now(), rules.attendance);
  return open.workDate < today ? open : null;
}

/**
 * 종료를 깜빡한 세션을 나중에 손으로 닫는다. 기획서 1번 세 번째 항목.
 *
 * 오늘 진행 중인 세션은 대상이 아니다 — 그건 "근무 종료" 버튼을 쓰면 되고,
 * 여기서 허용하면 시각을 임의로 적어 넣는 통로가 된다.
 */
export async function closeSessionManually(
  viewer: Viewer,
  /** endedAt 은 "HH:mm" — 보정 화면과 같은 형식 */
  opts: { sessionId: string; endedAt: string; note: string },
): Promise<{ workDate: string; minutes: number }> {
  const rules = await loadOrgRules(viewer.orgId);
  const zone = rules.attendance.timezone;
  const note = opts.note.trim();
  if (note.length === 0) {
    throw new Error("종료 시각을 직접 넣을 때는 사유가 필요합니다.");
  }
  if (!/^\d{2}:\d{2}$/.test(opts.endedAt)) {
    throw new Error("종료 시각을 HH:MM 형식으로 넣어 주세요.");
  }

  const [row] = await db
    .select({
      id: workSessions.id,
      userId: workSessions.userId,
      workDate: workSessions.workDate,
      startedAt: workSessions.startedAt,
      endedAt: workSessions.endedAt,
    })
    .from(workSessions)
    .where(eq(workSessions.id, opts.sessionId));

  if (!row) throw new Error("해당 근무 기록을 찾을 수 없습니다.");
  // 본인만. 팀장이 남의 기록을 손대는 건 보정(day_adjustments) 경로로 간다.
  if (row.userId !== viewer.id) {
    throw new AccessDenied("본인 근무 기록만 종료할 수 있습니다.");
  }
  if (row.endedAt) throw new Error("이미 종료된 근무입니다.");

  const today = resolveWorkDate(now(), rules.attendance);
  if (row.workDate >= today) {
    throw new Error(
      "오늘 진행 중인 근무는 '근무 종료' 버튼으로 끝내 주세요.",
    );
  }
  await assertOpenPeriod(viewer.orgId, row.workDate, rules);

  // 새벽 2시 퇴근처럼 종료가 시작보다 이르면 다음 날로 넘긴다 (보정 화면과 같은 규칙)
  let endedAt = DateTime.fromISO(`${row.workDate}T${opts.endedAt}`, { zone });
  if (!endedAt.isValid) throw new Error("종료 시각을 읽을 수 없습니다.");
  if (endedAt.toMillis() <= row.startedAt.getTime()) {
    endedAt = endedAt.plus({ days: 1 });
  }

  const minutes = Math.round(
    (endedAt.toMillis() - row.startedAt.getTime()) / 60_000,
  );
  const limit = rules.attendance.dailyLimitMinutes;
  if (limit !== null && minutes > limit) {
    throw new Error(
      `한 번에 ${Math.floor(minutes / 60)}시간이 됩니다. 1일 상한(${limit / 60}시간)을 넘는 시각은 넣을 수 없습니다.`,
    );
  }

  await db
    .update(workSessions)
    .set({
      endedAt: endedAt.toJSDate(),
      closedManually: true,
      closedNote: note,
      source: "manual",
    })
    .where(and(eq(workSessions.id, row.id), isNull(workSessions.endedAt)));

  await recomputeWorkDays({
    orgId: viewer.orgId,
    userId: viewer.id,
    from: row.workDate,
    to: row.workDate,
    rules: rules.attendance,
    asOf: now(),
  });
  await syncNotifications(viewer.orgId, now());

  return { workDate: row.workDate, minutes };
}

/** 지금 열려 있는 세션 (재실 여부). 팀 현황에서 한 번에 조회한다. */
export async function openSessionsForUsers(
  userIds: string[],
): Promise<Map<string, { startedAt: Date; workDate: string }>> {
  const map = new Map<string, { startedAt: Date; workDate: string }>();
  if (userIds.length === 0) return map;

  const rows = await db
    .select({
      userId: workSessions.userId,
      startedAt: workSessions.startedAt,
      workDate: workSessions.workDate,
    })
    .from(workSessions)
    .where(
      and(inArray(workSessions.userId, userIds), isNull(workSessions.endedAt)),
    )
    .orderBy(asc(workSessions.startedAt));

  // 여러 개가 열려 있으면(있어선 안 되지만) 가장 최근 것을 보여준다
  for (const r of rows) {
    map.set(r.userId, { startedAt: r.startedAt, workDate: r.workDate });
  }
  return map;
}
