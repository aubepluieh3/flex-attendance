import Link from "next/link";
import { DateTime } from "luxon";
import { loadOrgRules, loadTimeOff, loadWorkDays } from "@/db/access";
import { listAdjustments } from "@/db/adjust";
import { isPeriodClosed } from "@/db/close";
import { estimateFor } from "@/db/baseline";
import { sessionsByDate } from "@/db/checkin";
import { listMyTimeOff } from "@/db/timeoff";
import { resolvePeriod } from "@/lib/attendance/period";
import type { ComputedDay, DayFlag } from "@/lib/attendance/types";
import { now } from "@/lib/clock";
import { requestViewer } from "../viewer";
import { recordsAction } from "./actions";
import { PeriodNav } from "../period-nav";
import {
  ADJUST_KIND_LABEL as KIND_LABEL,
  dowOf,
  FLAG_LABEL,
  hm,
  SESSION_SOURCE_LABEL as SOURCE_LABEL,
  TIME_OFF_LABEL as OFF_LABEL,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; msg?: string; err?: string }>;
}) {
  const { period, msg, err } = await searchParams;
  const viewer = await requestViewer("/records");
  const rules = await loadOrgRules(viewer.orgId);
  const zone = rules.attendance.timezone;

  const asOf = now();
  const opts = {
    kind: rules.settlementKind,
    weekStartDay: rules.weekStartDay,
    timezone: zone,
  };
  const today = DateTime.fromJSDate(asOf, { zone }).toISODate()!;
  const range = resolvePeriod(period ?? today, opts);
  const isCurrent = range.start === resolvePeriod(today, opts).start;

  const days = await loadWorkDays(viewer, viewer.id, range);
  const history = await listAdjustments(viewer, viewer.id, range);
  const closed = await isPeriodClosed(viewer.orgId, range);
  const sessions = await sessionsByDate(
    viewer.id,
    range.start,
    range.end,
    rules,
  );
  /**
   * 휴가.
   *
   * 안 보여주면 연차 쓴 날이 "기록 없음"으로 나오고 화면이 보정하라고 권한다.
   * 쉬었다고 신고한 사람에게 근무 시간을 적으라고 하는 셈이다.
   */
  const off = new Map(
    (await loadTimeOff(viewer, viewer.id, range)).map((o) => [o.date, o]),
  );
  const myOff = await listMyTimeOff(viewer);
  /** 승인·대기 둘 다. 대기 중인 휴가도 신청자에게는 예정이다 */
  const offAll = new Map(
    myOff
      .filter((o) => o.status !== "rejected")
      .map((o) => [o.date, o] as const),
  );

  const byDate = new Map<string, ComputedDay>(days.map((d) => [d.workDate, d]));
  const adjustedDates = new Set(
    history.filter((h) => h.kind !== "revert").map((h) => h.workDate),
  );

  const allDates: string[] = [];
  let cursor = DateTime.fromISO(range.start, { zone });
  const last = DateTime.fromISO(range.end, { zone });
  while (cursor <= last) {
    allDates.push(cursor.toISODate()!);
    cursor = cursor.plus({ days: 1 });
  }
  /*
   * 이 화면의 목적은 "고칠 날 찾기"다. 아직 오지 않은 날을 카드로 늘어놓으면
   * 화면 대부분이 "아직 오지 않은 날입니다"가 된다. 주의 모양은 대시보드가 준다.
   *
   * 단 앞으로 잡힌 휴가는 보여준다. 안 보이면 "내가 연차 냈던가?"를
   * 확인할 방법이 없다.
   */
  /*
   * 재직기간 밖은 아예 카드를 만들지 않는다.
   *
   * 이 화면은 기록 없는 날마다 보정 폼을 펼치므로, 재직기간을 안 자르면
   * 7/20 입사자에게 7/1~7/19 보정 폼이 열린다 — 입사 전 근무를 신고할 수
   * 있게 된다. 목록에서 빼면 폼도 같이 없어진다.
   *
   * 기록이 있는 날은 예외다. 원본을 화면에서 지우면 입사일이 틀렸다는 걸
   * 아무도 모른다. 다만 이때도 보정은 막는다 (employedDate 로 아래에서 가른다).
   */
  const employedDate = (d: string) =>
    (viewer.hiredAt === null || d >= viewer.hiredAt) &&
    (viewer.resignedAt === null || d <= viewer.resignedAt);
  const hasRecord = new Set(
    days.filter((d) => d.tagCount > 0).map((d) => d.workDate),
  );
  const inScope = (d: string) => employedDate(d) || hasRecord.has(d);

  const dates = allDates.filter(
    (d) => inScope(d) && (d <= today || offAll.has(d)),
  );
  const upcoming = allDates.filter(
    (d) => inScope(d) && d > today && !offAll.has(d),
  );
  // 재직기간 밖 = 근무 신고 대상이 아니다. 마감과 같은 이유로 폼을 잠근다.
  const lockedDate = (d: string) => closed || !employedDate(d);

  const time = (d: Date | null) =>
    d ? DateTime.fromJSDate(d, { zone }).toFormat("HH:mm") : "";

  /**
   * 미완료인 날은 퇴근 시각을 미리 채워준다.
   *
   * 0분으로 두고 직접 적게 하면 정직한 사람만 실제 시간을 적고 아닌 사람은
   * 부풀린다. 시스템이 먼저 제시하면 정직한 쪽은 확인만 하면 되고, 부풀리려면
   * 제시값을 벗어나야 해서 그 차이가 검토 대상이 된다.
   */
  const estimates = new Map<string, Awaited<ReturnType<typeof estimateFor>>>();
  for (const d of days) {
    if (d.status !== "incomplete") continue;
    estimates.set(d.workDate, await estimateFor(viewer.id, d.workDate, rules));
  }

  /**
   * 날짜 카드 하나. 주차 묶음 안에서 부르므로 함수로 뺐다.
   *
   * 이 화면의 목적은 "고칠 날 찾기"인데 31일치를 전부 펼쳐 두면 손댈 일 없는
   * 날 20일이 화면의 대부분을 먹고(실측 9.7화면) 고쳐야 할 날이 그 사이에
   * 묻힌다. 대시보드가 쓰는 주차 접기와 같은 패턴으로 접는다.
   */
  const dayCard = (date: string) => {
    const day = byDate.get(date);
    const dt = DateTime.fromISO(date, { zone });
    const dow = dowOf(dt.weekday);
    // 승인된 휴가(off)가 없으면 대기 중인 신청이라도 보여준다
    const approvedOff = off.get(date);
    const dayOff = approvedOff ?? offAll.get(date);
    const offPending = !approvedOff && Boolean(offAll.get(date));
    /**
     * 온종일 휴가면 손댈 게 없다. 반차는 반나절 근무가 있으므로 보정 대상이다.
     * 휴가일에 기록이 있으면 그건 "휴가일 근무"로 따로 걸린다(정산에서 판정).
     */
    const fullDayOff = dayOff?.kind === "full" || dayOff?.kind === "unpaid";
    // 아직 오지 않은 날은 고칠 것이 없다 (휴가 때문에 목록에 올라온 날)
    const needsFix =
      !fullDayOff && date <= today && (!day || day.status === "incomplete");
    const wasAdjusted = adjustedDates.has(date);
    const daySessions = sessions.get(date) ?? [];
    /**
     * 닫아야 할 앱 세션. 사원증에서 유도된 구간(id 없음)은 여기 들어오지
     * 않는다 — 원본 태그를 고칠 수는 없으므로 그건 보정으로 간다.
     */
    const toClose =
      date < today
        ? daySessions.filter((s) => s.id !== null && !s.endedAt)
        : [];
    // 세션을 닫으면 저절로 맞는 날이다. 보정 안내까지 띄우면 길이 두 개로 보인다.
    const dangling = toClose.length > 0;

    return (
      // id 를 둬서 대시보드에서 "그 날"로 바로 내려올 수 있게 한다
      <section className="card" key={date} id={date}>
        <div className="day-head">
          <strong>
            {dt.toFormat("M월 d일")} ({dow})
          </strong>
          {day ? (
            day.status === "incomplete" ? (
              <span className="tag">미완료</span>
            ) : (
              <span className="day-sum">
                {/*
                      나눠 일한 날은 "첫 출근~마지막 퇴근"을 보여주면 안 된다.
                      09~12 + 19~21 을 09~21 로 쓰면 사이 7시간까지 일한 것처럼 읽힌다.
                    */}
                {day.sessionCount > 1
                  ? `${day.sessionCount}번 나눠 근무`
                  : `${time(day.firstInAt)}~${time(day.lastOutAt)}`}{" "}
                · 실근무 {hm(day.workMinutes)}
              </span>
            )
          ) : (
            <span className="day-sum none">기록 없음</span>
          )}
          {dayOff && (
            <span className="tag">
              {OFF_LABEL[dayOff.kind]}
              {offPending && " (승인 대기)"}
            </span>
          )}
          {day?.status === "open" && (
            <span className="status good inline">
              <span className="dot" aria-hidden="true" />
              근무 중
            </span>
          )}
          {wasAdjusted && <span className="tag">보정됨</span>}
          {day?.flags.map((f) => (
            <span className="tag" key={f}>
              {FLAG_LABEL[f]}
            </span>
          ))}
        </div>

        {daySessions.length > 0 && (
          <ul className="sessions">
            {daySessions.map((s, i) => (
              <li key={s.id ?? `badge-${i}`}>
                <span className="span">
                  {time(s.startedAt)}~
                  {/*
                        지난 날의 열린 구간은 "진행 중"이 아니다. 사원증을 한 번만
                        찍고 퇴근한 날에 "진행 중"이라고 쓰면 나흘 전부터 일하는
                        중이라는 뜻이 된다.
                      */}
                  {s.endedAt ? (
                    time(s.endedAt)
                  ) : date >= today ? (
                    <b>진행 중</b>
                  ) : (
                    <b>종료 기록 없음</b>
                  )}
                </span>
                <span className="none">
                  {SOURCE_LABEL[s.source]}
                  {s.closedManually &&
                    ` · 종료 시각 직접 입력: ${s.closedNote}`}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/*
              어제 종료를 깜빡한 세션. 기획서 1번 "체크아웃을 깜빡한 경우 나중에 수정".
              하루 전체를 덮어쓰는 보정과 달리 그 세션만 닫으므로, 같은 날의 다른
              세션과 사원증 기록은 그대로 남는다.
            */}
        {!lockedDate(date) &&
          toClose.map((s) => (
            <form action={recordsAction} className="adjust" key={s.id}>
              <input type="hidden" name="op" value="closeSession" />
              <input type="hidden" name="sessionId" value={s.id!} />
              <input type="hidden" name="workDate" value={date} />
              <input type="hidden" name="period" value={range.start} />
              <label className="field">
                <span>{time(s.startedAt)} 시작 · 종료 시각</span>
                <input
                  type="time"
                  name="endedAt"
                  required
                  defaultValue={time(estimates.get(date)?.lastOutAt ?? null)}
                />
              </label>
              <label className="field grow">
                <span>
                  사유<b> *</b>
                </span>
                <input
                  type="text"
                  name="note"
                  required
                  placeholder="종료 버튼을 누르지 않고 퇴근했습니다"
                />
              </label>
              <button type="submit">이 근무 종료</button>
            </form>
          ))}

        {!closed && !dangling && estimates.get(date) && (
          <p className="empty" style={{ marginBottom: 10 }}>
            {estimates.get(date)!.source === "history"
              ? `평소 근무 패턴(최근 ${estimates.get(date)!.sampleDays}일)으로 퇴근 시각을 채워뒀습니다. 맞으면 사유만 적고 보정하세요.`
              : "소정근로 기준으로 퇴근 시각을 채워뒀습니다. 맞으면 사유만 적고 보정하세요."}
          </p>
        )}

        {/*
              아직 오지 않은 날에는 보정할 것이 없다.
              폼을 열어두면 8월 2일 근무를 미리 신고할 수 있고, 안 지난 날 6개가
              화면 길이를 세 배로 늘린다.
            */}
        {!closed && dayOff && !day && (
          <p className="empty">
            {OFF_LABEL[dayOff.kind]}
            {offPending
              ? "를 신청했습니다. 승인되면 소정근로에서 빠집니다."
              : fullDayOff
                ? "로 등록된 날입니다. 소정근로에서 이미 빠져 있으니 따로 보정할 것이 없습니다."
                : "로 등록된 날입니다. 반나절은 근무일이라 기록이 들어옵니다."}
          </p>
        )}

        {!closed && !dayOff && date > today && (
          <p className="empty">아직 오지 않은 날입니다.</p>
        )}

        {/*
              지난 날에 손댈 게 있으면 펼쳐 둔다. 오늘은 아직 근무 중일 수
              있으니 먼저 펼치지 않는다 — 시작하지도 않은 날에 보정 폼이
              열려 있으면 "여기에 시간을 적으라"는 말로 읽힌다.
            */}
        {/*
              재직기간 밖인데 기록이 있는 날. 기록은 보여주지만 보정은 막는다 —
              입사 전 근무를 신고할 수 있게 하면 개념이 화면에서 깨진다.
            */}
        {!employedDate(date) && (
          <p className="empty">
            재직 기간 밖입니다. 집계에 들어가지 않고 보정할 수도 없습니다 —
            입사일이 잘못 등록되었다면 HR에 알려주세요.
          </p>
        )}

        {!lockedDate(date) && date <= today && !(fullDayOff && !day) && (
          <details className="adjust-box" open={needsFix && date < today}>
            <summary>
              {needsFix && date < today ? "이 날 보정하기" : "시각 정정"}
              {wasAdjusted && " · 보정 이력 있음"}
            </summary>
            <form action={recordsAction} className="adjust">
              <input type="hidden" name="op" value="adjust" />
              <input type="hidden" name="workDate" value={date} />
              <input type="hidden" name="period" value={range.start} />
              <label className="field">
                <span>출근</span>
                <input
                  type="time"
                  name="firstIn"
                  defaultValue={time(day?.firstInAt ?? null)}
                />
              </label>
              <label className="field">
                <span>퇴근{estimates.get(date) ? " (추정)" : ""}</span>
                <input
                  type="time"
                  name="lastOut"
                  defaultValue={
                    time(day?.lastOutAt ?? null) ||
                    time(estimates.get(date)?.lastOutAt ?? null)
                  }
                />
              </label>
              <label className="field">
                <span>외근 시간(분)</span>
                <input
                  type="number"
                  name="addedMinutes"
                  min={0}
                  max={1440}
                  step={10}
                  placeholder="예: 480 = 8시간"
                />
              </label>
              <label className="field grow">
                <span>
                  사유<b> *</b>
                </span>
                <input
                  type="text"
                  name="reason"
                  required
                  placeholder={
                    needsFix
                      ? "사원증을 놓고 와서 퇴근을 못 찍었습니다"
                      : "정정 사유"
                  }
                />
              </label>
              <button type="submit">보정</button>
            </form>

            {wasAdjusted && (
              <form action={recordsAction} className="adjust">
                <input type="hidden" name="op" value="revert" />
                <input type="hidden" name="workDate" value={date} />
                <input type="hidden" name="period" value={range.start} />
                <button type="submit" className="pill">
                  보정 취소 (원본으로)
                </button>
              </form>
            )}
          </details>
        )}
      </section>
    );
  };

  /**
   * 이 날에 손댈 것이 있나. 주차를 접을지 결정하는 기준이다.
   *
   * 주말·공휴일의 "기록 없음"은 손댈 것이 아니다. 처음에 그걸 안 걸렀더니
   * 모든 주에 확인 2건(토·일)이 붙어서 다섯 주가 전부 펼쳐졌다 — 접기가
   * 아무 일도 안 했다.
   *
   * 보정 이력이 있는 날도 넣지 않는다. 그건 "이미 손댄 것"이고, 넣으면
   * 한 번 보정한 주가 기간 끝까지 펼쳐진 채로 남는다.
   */
  const businessDay = (d: string) =>
    !rules.attendance.weekendDays.includes(
      DateTime.fromISO(d, { zone }).weekday,
    ) && !rules.attendance.holidays.includes(d);

  const needsAttention = (date: string) => {
    if (!employedDate(date)) return true; // 재직기간 밖인데 기록이 있는 날
    if (date > today) return false;
    const dayOff = off.get(date) ?? offAll.get(date);
    if (dayOff?.kind === "full" || dayOff?.kind === "unpaid") return false;
    const d = byDate.get(date);
    // 기록이 있으면 미완료·규정 위반만, 없으면 영업일에 빠진 것만
    return d ? d.status === "incomplete" || d.flags.length > 0 : businessDay(date);
  };

  /*
   * 주차로 묶는다. 경계는 조직의 주 시작일을 따르고 정산기간을 넘지 않는다 —
   * 대시보드(app/page.tsx)의 weekGroups 와 같은 규칙이라 두 화면의 "3주차"가
   * 같은 날짜를 뜻한다. 다르면 화면을 오갈 때마다 다시 세게 된다.
   */
  const weeks: {
    key: string;
    ord: string;
    span: string;
    dates: string[];
    workedMinutes: number;
    attention: number;
    hasToday: boolean;
  }[] = [];

  for (const date of dates) {
    const w = resolvePeriod(date, {
      kind: "week",
      weekStartDay: rules.weekStartDay,
      timezone: zone,
    });
    let g = weeks.find((x) => x.key === w.start);
    if (!g) {
      g = {
        key: w.start,
        ord: "",
        span: "",
        dates: [],
        workedMinutes: 0,
        attention: 0,
        hasToday: false,
      };
      weeks.push(g);
    }
    g.dates.push(date);
    g.workedMinutes += byDate.get(date)?.workMinutes ?? 0;
    if (needsAttention(date)) g.attention += 1;
    if (date === today) g.hasToday = true;
  }
  weeks.forEach((g, i) => {
    g.ord = `${i + 1}주차`;
    const from = DateTime.fromISO(g.dates[0], { zone });
    const to = DateTime.fromISO(g.dates[g.dates.length - 1], { zone });
    // 같은 달이면 뒤쪽 월을 지운다 ("7/13~7/19" → "7/13~19") — 390px 에서
    // 배지까지 한 줄에 들어가려면 그 폭이 필요하다 (대시보드와 같은 처리)
    const sameMonth = from.month === to.month;
    g.span =
      g.dates.length === 1
        ? from.toFormat("M/d")
        : `${from.toFormat("M/d")}~${sameMonth ? to.toFormat("d") : to.toFormat("M/d")}`;
  });

  return (
    <main className="page">
      <div className="head">
        <h1>내 기록 · 보정</h1>
        <span className="team">{viewer.teamName ?? rules.orgName}</span>
        {/*
          오른쪽 칩은 "이 화면에서 지금 알아야 할 상태"를 넣는 자리다.
          관리 화면에서는 이름·역할(권한이 갈리므로), 기간을 보는 화면에서는
          마감 여부. 이 화면은 마감되면 보정 폼이 전부 사라지는데 그 이유가
          카드 안에만 있어서 위에서 안 보였다.
        */}
        {closed && <span className="chip">마감됨</span>}
      </div>
      <p className="sub">
        <PeriodNav
          basePath="/records"
          range={range}
          kind={rules.settlementKind}
          weekStartDay={rules.weekStartDay}
          timezone={zone}
          isCurrent={isCurrent}
        />
        <br />
        <span className="dim">
          사원증 기록이 빠졌거나 외근을 한 날을 보정합니다. 원본 기록은 지우지
          않고 보정 이력만 쌓입니다.
        </span>
      </p>

      {closed && (
        <section className="card">
          <ul className="issues">
            <li>
              <span className="icon warn" aria-hidden="true">
                !
              </span>
              <span>
                <span className="what">마감된 정산기간입니다</span>
                <br />
                <span className="why">
                  확정된 기록은 더 바뀌지 않습니다. 고쳐야 할 게 있으면 HR에
                  재마감을 요청하세요.
                </span>
              </span>
            </li>
          </ul>
        </section>
      )}

      {(msg || err) && (
        <section className="card">
          <ul className="issues">
            <li>
              <span
                className={`icon ${err ? "crit" : "warn"}`}
                aria-hidden="true"
              >
                !
              </span>
              <span className="what">{err ?? msg}</span>
            </li>
          </ul>
        </section>
      )}

      {/*
        손댈 것이 있는 주와 이번 주만 펼친다. 나머지는 한 줄로 접는다 —
        정상인 날 카드가 화면을 다 먹으면 고쳐야 할 날을 찾을 수 없다.
      */}
      {weeks.length === 0 ? (
        <p className="empty">이 정산기간에 표시할 날이 없습니다.</p>
      ) : (
        weeks.map((g) => (
          <details
            className="weekgroup"
            key={g.key}
            open={g.hasToday || g.attention > 0}
          >
            <summary>
              <span className="ord">{g.ord}</span>
              <span className="span">{g.span}</span>
              {g.attention > 0 && (
                <span className="badge">확인 {g.attention}</span>
              )}
              {g.hasToday && <span className="now">이번 주</span>}
              <span className="sum">{hm(g.workedMinutes)}</span>
            </summary>
            {g.dates.map(dayCard)}
          </details>
        ))
      )}

      {upcoming.length > 0 && (
        <p className="empty" style={{ margin: "0 0 14px 4px" }}>
          {DateTime.fromISO(upcoming[0], { zone }).toFormat("M월 d일")}
          {upcoming.length > 1 &&
            ` ~ ${DateTime.fromISO(upcoming.at(-1)!, { zone }).toFormat("M월 d일")}`}
          은 아직 오지 않았습니다.
        </p>
      )}

      {/*
        휴가는 별도 화면이다 (app/time-off).
        보정은 실제로 일한 것을 신고하는 것이고 휴가는 근로 의무를 면제받는
        것이라 성격이 다르다. 여기 묶여 있었을 때 신청 폼이 31일치 카드 뒤
        9화면째에 있었다. 링크만 남긴다 — 이 화면에서 휴가 badge 를 본 사람이
        바로 갈 곳이 필요하다.
      */}
      <p className="empty">
        휴가 신청과 승인 상태는 <Link href="/time-off">휴가</Link>에서 봅니다.
      </p>

      <section className="card">
        <h2>보정 이력</h2>
        {history.length === 0 ? (
          <p className="empty">아직 보정한 기록이 없습니다.</p>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>대상 날짜</th>
                  <th>종류</th>
                  <th>내용</th>
                  <th>사유</th>
                  <th>기록</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>
                      {DateTime.fromISO(h.workDate, { zone }).toFormat("M/d")}
                    </td>
                    <td>{KIND_LABEL[h.kind]}</td>
                    <td>
                      {h.kind === "revert"
                        ? "—"
                        : [
                            h.overrideFirstInAt || h.overrideLastOutAt
                              ? `${time(h.overrideFirstInAt)}~${time(h.overrideLastOutAt)}`
                              : null,
                            h.addedMinutes ? `+${hm(h.addedMinutes)}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                    </td>
                    <td>{h.reason}</td>
                    <td className="none">
                      {h.createdByName} ·{" "}
                      {DateTime.fromJSDate(h.createdAt, { zone }).toFormat(
                        "M/d HH:mm",
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
