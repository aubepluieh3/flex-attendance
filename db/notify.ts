import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "./client";
import { notifications, teams, timeOff, users } from "./schema";
import { loadOrgRules, type OrgRules, type Viewer } from "./access";
import { isPeriodClosed, loadPeriodState } from "./close";
import { loadTeamRows } from "./team";
import { listPendingFor } from "./timeoff";
import {
  resolvePeriod,
  shiftPeriod,
  type PeriodRange,
} from "@/lib/attendance/period";
import { computePeriodSummary, isClosable } from "@/lib/attendance/settle";
import { now } from "@/lib/clock";
import { hm, md, TIME_OFF_LABEL } from "@/lib/format";

/**
 * 알림 동기화.
 *
 * 실시간 알림은 원리적으로 불가능하다 — 근태가 CSV 임포트로 들어오므로 "지금
 * 근무 중" 같은 상태를 앱이 모른다. 대신 임포트·보정·마감 같은 쓰기 이벤트
 * 뒤에 "지금 확인해야 할 것"을 다시 계산해서 알림함을 맞춘다.
 *
 * 조건이 해소되면 알림을 지운다. 알림은 감사 기록이 아니라 할 일 목록이다.
 */

type Draft = {
  userId: string;
  kind:
    | "incomplete_day"
    | "rule_violation"
    | "legal_limit"
    | "period_closing"
    | "post_close_change"
    | "team_review"
    | "time_off_pending"
    | "time_off_decided";
  dedupeKey: string;
  title: string;
  body: string;
  href: string;
  /** 정산기간과 무관한 알림(휴가 승인 등)은 null */
  periodStart: string | null;
};

/** 한 사람의 현재 상태에서 필요한 알림을 뽑는다 */
async function draftsForMember(
  member: { userId: string; role: string; summary: ReturnType<typeof computePeriodSummary> },
  range: PeriodRange,
  rules: OrgRules,
  asOf: Date,
  orgId: string,
): Promise<Draft[]> {
  const zone = rules.attendance.timezone;
  const out: Draft[] = [];
  const s = member.summary;
  const base = { userId: member.userId, periodStart: range.start };
  /*
   * 링크에 기간을 붙인다.
   *
   * 지난 기간의 항목인데 href 가 "/records" 면 이번 기간 화면에 떨어져서
   * 그 날이 목록에 없다. 알림을 눌러도 아무것도 못 보는 상태가 된다.
   * period 는 그 기간 안의 아무 날짜여도 화면이 기간을 되찾는다.
   */
  const at = (path: string, anchor?: string) =>
    `${path}?period=${range.start}${anchor ? `#${anchor}` : ""}`;

  for (const date of s.incompleteDates) {
    out.push({
      ...base,
      kind: "incomplete_day",
      dedupeKey: `incomplete:${date}`,
      title: `${md(date, zone)} 퇴근 기록이 없습니다`,
      body: "출근 기록만 있어 집계에서 빠져 있습니다. 퇴근 시각을 보정해 주세요.",
      // 그 날 카드까지 내려간다
      href: at("/records", date),
    });
  }

  if (s.flaggedDates.length > 0) {
    const dates = s.flaggedDates.map((f) => md(f.date, zone)).join(", ");
    out.push({
      ...base,
      kind: "rule_violation",
      dedupeKey: `violation:${range.start}:${s.flaggedDates.map((f) => f.date).join(",")}`,
      title: `규정 확인이 필요한 날이 ${s.flaggedDates.length}일 있습니다`,
      body: `${dates}. 의무근로시간대나 1일 상한을 확인해 주세요.`,
      href: at("/records", s.flaggedDates[0].date),
    });
  }

  if (s.exceedsAvgWeeklyLimit) {
    out.push({
      ...base,
      kind: "legal_limit",
      dedupeKey: `legal:${range.start}`,
      title: `주 평균 ${hm(s.avgWeeklyMinutes)} — 법정 한도 초과`,
      body: "남은 기간 근무를 줄이고 팀장과 조정하세요.",
      href: at("/"),
    });
  }

  // 정산기간이 끝났고 아직 마감 전인데 목표를 못 채웠으면 알린다.
  // 마감되면 더 못 고치므로 이 구간이 마지막 기회다.
  const periodEnded =
    DateTime.fromJSDate(asOf, { zone }).toISODate()! > range.end;
  const notYetClosed = !isClosable(
    range.end,
    rules.closeGraceDays,
    asOf,
    zone,
  );
  if (periodEnded && notYetClosed && s.remainingMinutes > 0) {
    out.push({
      ...base,
      kind: "period_closing",
      dedupeKey: `closing:${range.start}`,
      title: `${md(range.start, zone)}~${md(range.end, zone)} 정산이 곧 마감됩니다`,
      body: `소정근로까지 ${hm(s.remainingMinutes)} 부족합니다. 빠진 기록이 있으면 지금 보정해 주세요.`,
      href: at("/records"),
    });
  }

  const state = await loadPeriodState(orgId, member.userId, range, s);
  if (state.diff?.changed) {
    out.push({
      ...base,
      kind: "post_close_change",
      dedupeKey: `postclose:${range.start}`,
      title: "마감 후 근무 기록이 바뀌었습니다",
      body: "공식 기록은 마감 시점 값입니다. 반영이 필요하면 HR에 재마감을 요청하세요.",
      href: at("/"),
    });
  }

  return out;
}

/**
 * 조직 전체 알림을 현재 상태에 맞춘다.
 * 쓰기 이벤트 뒤에 부르거나 배치(npm run db:notify)로 돌린다.
 */
export async function syncNotifications(
  orgId: string,
  asOf: Date = now(),
): Promise<{ created: number; resolved: number }> {
  const rules = await loadOrgRules(orgId);
  const zone = rules.attendance.timezone;
  const opts = {
    kind: rules.settlementKind,
    weekStartDay: rules.weekStartDay,
    timezone: zone,
  };
  const current = resolvePeriod(
    DateTime.fromJSDate(asOf, { zone }).toISODate()!,
    opts,
  );

  /**
   * 현재 기간만 보면 안 된다.
   *
   * 기간이 끝나도 유예일 동안은 아직 고칠 수 있고, 마감 임박 알림은 애초에
   * "지난 기간"에 대한 것이다. 현재 기간만 동기화하면 새 기간이 시작되는 순간
   * 지난 기간 알림이 전부 "해소"로 지워지고, 마감 임박 알림은 생성될 수도 없다.
   *
   * 아직 마감되지 않은 과거 기간까지 함께 본다 (최대 6기간으로 제한).
   */
  const ranges: PeriodRange[] = [current];
  for (let back = 1; back <= 6; back += 1) {
    const past = shiftPeriod(current, -back, opts);
    const closed = await isPeriodClosed(orgId, past);
    if (closed) {
      // 마감된 기간은 "마감 후 변경"만 볼 값이 있으므로 한 칸만 더 본다
      if (back === 1) ranges.push(past);
      break;
    }
    ranges.push(past);
  }

  // 시스템 권한으로 전원 요약을 읽는다 (HR 뷰어를 흉내내지 않고 hr 역할로)
  const [hrUser] = await db
    .select({
      id: users.id,
      orgId: users.orgId,
      name: users.name,
      role: users.role,
      teamId: users.teamId,
      teamName: teams.name,
    })
    .from(users)
    .leftJoin(teams, eq(users.teamId, teams.id))
    .where(and(eq(users.orgId, orgId), eq(users.role, "hr")));

  if (!hrUser) return { created: 0, resolved: 0 };

  /*
   * 임원에게는 개인 알림을 만들지 않는다.
   *
   * 임원은 근태를 찍지 않고 개인 상세도 볼 수 없다. "정산이 곧 마감됩니다"
   * 같은 걸 받아도 할 수 있는 게 없다 — 아무 행동으로 이어지지 않는 알림은
   * 배지 숫자만 올리고 알림함의 신뢰를 떨어뜨린다.
   */
  const execRows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.role, "executive")));
  const execIds = new Set(execRows.map((r) => r.id));

  const drafts: Draft[] = [];
  for (const range of ranges) {
    const rows = await loadTeamRows(hrUser as Viewer, range, rules, asOf);
    for (const r of rows) {
      if (execIds.has(r.userId)) continue;
      drafts.push(
        ...(await draftsForMember(
          { userId: r.userId, role: "member", summary: r.summary },
          range,
          rules,
          asOf,
          orgId,
        )),
      );
    }
  }

  /**
   * 팀장에게는 자기 팀 확인 필요를 하나로 묶어 알린다.
   *
   * 전사 목록에서 세면 안 된다 — 팀장은 자기 팀만 볼 수 있으므로 열 수도 없는
   * 사람의 건수를 알리면 안 된다. 팀장별로 자기 범위를 다시 읽는다.
   */
  const managerRows = await db
    .select({
      id: users.id,
      orgId: users.orgId,
      name: users.name,
      role: users.role,
      teamId: users.teamId,
      teamName: teams.name,
    })
    .from(users)
    .leftJoin(teams, eq(users.teamId, teams.id))
    .where(
      and(
        eq(users.orgId, orgId),
        eq(users.role, "manager"),
        eq(users.active, true),
      ),
    );

  // 개인 알림과 같은 기간 범위를 본다. 팀장만 현재 기간으로 좁히면,
  // 유예 중인 지난 기간에 팀원 미완료가 있어도 팀장은 모르고 지나간다.
  for (const m of managerRows) {
    for (const range of ranges) {
      const teamRows = await loadTeamRows(m as Viewer, range, rules, asOf);
      const mine = teamRows.filter(
        (r) => r.userId !== m.id && r.review.total > 0,
      );
      if (mine.length === 0) continue;
      drafts.push({
        userId: m.id,
        kind: "team_review",
        dedupeKey: `team:${range.start}:${mine.length}`,
        title: `${md(range.start, zone)}~${md(range.end, zone)} 팀원 ${mine.length}명에게 확인할 항목이 있습니다`,
        body: mine
          .slice(0, 3)
          .map((r) => `${r.name} ${r.review.total}건`)
          .join(" · "),
        // 지난 기간 팀원 항목인데 이번 기간 화면으로 보내면 확인할 게 안 보인다
        href: `/team?period=${range.start}`,
        periodStart: range.start,
      });
    }
  }

  /*
   * 휴가 승인 대기.
   *
   * 팀장이 팀 현황을 열지 않으면 신청이 방치된다. 다른 사람이 기다리는
   * 유일한 항목이라 알림에 올린다. 결정되면 조건이 사라져 저절로 없어진다.
   */
  const approvers = await db
    .select({
      id: users.id,
      orgId: users.orgId,
      name: users.name,
      role: users.role,
      teamId: users.teamId,
      teamName: teams.name,
    })
    .from(users)
    .leftJoin(teams, eq(users.teamId, teams.id))
    .where(
      and(
        eq(users.orgId, orgId),
        inArray(users.role, ["manager", "hr"]),
        eq(users.active, true),
      ),
    );

  for (const a of approvers) {
    const waiting = await listPendingFor(a as Viewer);
    if (waiting.length === 0) continue;
    drafts.push({
      userId: a.id,
      kind: "time_off_pending",
      dedupeKey: `off:${waiting.length}:${waiting[0].id}`,
      title: `휴가 승인 대기 ${waiting.length}건`,
      body: waiting
        .slice(0, 3)
        .map((w) => `${w.userName} ${md(w.date, zone)} ${TIME_OFF_LABEL[w.kind]}`)
        .join(" · "),
      href: "/team",
      periodStart: null,
    });
  }

  /*
   * 결정 결과는 신청자에게. 이건 상태가 아니라 사건이라 이 구조와 안 맞는다 —
   * "최근 7일 안에 결정된 것"을 상태로 보고 그 기간이 지나면 사라지게 한다.
   */
  const recent = await db
    .select({
      id: timeOff.id,
      userId: timeOff.userId,
      date: timeOff.date,
      kind: timeOff.kind,
      status: timeOff.status,
      decisionNote: timeOff.decisionNote,
    })
    .from(timeOff)
    .where(
      and(
        eq(timeOff.orgId, orgId),
        ne(timeOff.status, "pending"),
        gte(
          timeOff.decidedAt,
          DateTime.fromJSDate(asOf).minus({ days: 7 }).toJSDate(),
        ),
      ),
    );

  for (const r of recent) {
    const approved = r.status === "approved";
    drafts.push({
      userId: r.userId,
      kind: "time_off_decided",
      dedupeKey: `offresult:${r.id}:${r.status}`,
      title: `${md(r.date, zone)} ${TIME_OFF_LABEL[r.kind as "full"]} 신청이 ${approved ? "승인되었습니다" : "반려되었습니다"}`,
      body: approved
        ? "소정근로에서 빠집니다."
        : r.decisionNote || "사유가 적혀 있지 않습니다.",
      // 그 날짜를 period 로 넘기면 화면이 해당 정산기간을 되찾는다
      href: `/records?period=${r.date}`,
      periodStart: null,
    });
  }

  // ── 반영: 없는 건 만들고, 조건이 사라진 건 지운다 ──
  const existing = await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      dedupeKey: notifications.dedupeKey,
    })
    .from(notifications)
    .where(eq(notifications.orgId, orgId));

  const wanted = new Set(drafts.map((d) => `${d.userId}|${d.dedupeKey}`));
  const stale = existing.filter(
    (e) => !wanted.has(`${e.userId}|${e.dedupeKey}`),
  );

  if (stale.length > 0) {
    await db.delete(notifications).where(
      inArray(
        notifications.id,
        stale.map((s) => s.id),
      ),
    );
  }

  /*
   * 이미 있는 건은 내용을 덮어쓴다.
   *
   * onConflictDoNothing 이면 문구나 링크를 고쳐도 이미 만들어진 알림에는
   * 영원히 반영되지 않는다. dedupeKey 는 "같은 사유"를 뜻하므로, 같은 사유의
   * 표현이 바뀌었으면 갱신되는 게 맞다. createdAt 은 건드리지 않는다 —
   * 언제 처음 생긴 항목인지가 사용자에게는 정보다.
   */
  let touched = 0;
  if (drafts.length > 0) {
    const upserted = await db
      .insert(notifications)
      .values(drafts.map((d) => ({ ...d, orgId })))
      .onConflictDoUpdate({
        target: [notifications.userId, notifications.dedupeKey],
        set: {
          kind: sql`excluded.kind`,
          title: sql`excluded.title`,
          body: sql`excluded.body`,
          href: sql`excluded.href`,
          periodStart: sql`excluded.period_start`,
        },
      })
      .returning({ id: notifications.id });
    touched = upserted.length;
  }

  return { created: touched, resolved: stale.length };
}

/**
 * 앱을 열 때 갱신.
 *
 * 시간이 지나야 조건이 생기는 알림이 있다 — 어제 안 닫힌 세션이 "퇴근 기록
 * 없음"이 되는 것, 유예일이 지나 "마감 임박"이 되는 것. 쓰기 액션에만
 * 붙여두면 아무도 쓰지 않는 날에는 알림이 안 생긴다.
 *
 * 배치로 돌릴 필요는 없다. 알림은 앱 안에서만 보이므로(이메일·푸시 없음)
 * 사용자가 여는 시점에 맞으면 충분하다. 새벽에 만들어 둘 이유가 없다.
 *
 * 문턱을 두는 이유: 매 요청마다 전사 재계산은 비싸다. 근태는 하루 한두 번
 * 열어보는 앱이라 몇 분 단위면 충분하다.
 *
 * 마지막 시각을 메모리에 두는 이유: 인스턴스가 여러 개면 각자 한 번씩 돌지만
 * sync 는 멱등이라 결과가 같다. DB 컬럼을 늘리는 값이 아직 없다.
 */
const SYNC_THROTTLE_MS = 5 * 60_000;
const lastSyncAt = new Map<string, number>();

export async function syncIfStale(
  orgId: string,
  asOf: Date = now(),
): Promise<boolean> {
  const prev = lastSyncAt.get(orgId);
  if (prev !== undefined && asOf.getTime() - prev < SYNC_THROTTLE_MS) {
    return false;
  }
  // 먼저 찍어서 같은 순간에 들어온 요청들이 같이 돌지 않게 한다
  lastSyncAt.set(orgId, asOf.getTime());
  try {
    await syncNotifications(orgId, asOf);
    return true;
  } catch (e) {
    // 실패했으면 문턱을 풀어 다음 요청이 다시 시도하게 둔다
    lastSyncAt.delete(orgId);
    throw e;
  }
}

/**
 * 읽음 개념을 두지 않는다.
 *
 * 이 알림은 메일함이 아니라 다시 계산되는 할 일 목록이다. 조건이 해소되면
 * 저절로 사라진다. 거기에 읽음을 얹으면 "봤다"가 "처리했다"로 읽힌다 —
 * 퇴근 기록이 아직 빠져 있는데 배지만 꺼진 상태가 만들어진다.
 *
 * 대신 숫자를 "확인할 항목 수"로 둔다. 그러면 목록과 항상 같은 값이고,
 * 쳐다봐서는 안 줄고 고쳐야 줄어든다.
 */
export type NotificationRow = {
  id: string;
  kind: Draft["kind"];
  title: string;
  body: string;
  href: string;
  createdAt: Date;
};

export async function listNotifications(
  viewer: Viewer,
): Promise<NotificationRow[]> {
  return db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.userId, viewer.id))
    .orderBy(desc(notifications.createdAt));
}

/** 확인할 항목 수 + 위법 소지 여부. 색은 심각도, 숫자는 개수를 말한다 */
export async function openItemCount(
  viewer: Viewer,
): Promise<{ total: number; critical: boolean }> {
  const rows = await db
    .select({ kind: notifications.kind })
    .from(notifications)
    .where(eq(notifications.userId, viewer.id));

  return {
    total: rows.length,
    // 주 평균 52시간 초과와 마감 후 변경만 빨강. 나머지는 개수일 뿐이다
    critical: rows.some(
      (r) => r.kind === "legal_limit" || r.kind === "post_close_change",
    ),
  };
}
