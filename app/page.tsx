import { DateTime } from "luxon";
import { computePeriodSummary } from "@/lib/attendance/settle";
import { resolvePeriod } from "@/lib/attendance/period";
import type { ComputedDay } from "@/lib/attendance/types";
import {
  clock,
  dateLabel,
  eachDate,
  FLAG_LABEL,
  hm,
  TIME_OFF_LABEL as OFF_LABEL,
} from "@/lib/format";
import { isFixedClock, now } from "@/lib/clock";
import { loadOrgRules, loadTimeOff, loadWorkDays } from "@/db/access";
import { loadPeriodState } from "@/db/close";
import { danglingSession } from "@/db/checkin";
import Link from "next/link";
import {
  leaveTimeFor,
  minutesIncludingOpen,
} from "@/lib/attendance/sessions";
import { requestViewer } from "./viewer";
import { PeriodNav } from "./period-nav";
import { TodayCard } from "./today-card";

// DB를 읽으므로 빌드 시점에 프리렌더하지 않는다
export const dynamic = "force-dynamic";

/** 차트 y축 최대 (10시간). 1일 소정근로 8시간 기준선을 그린다. */
const SCALE_MINUTES = 10 * 60;
const REFERENCE_MINUTES = 8 * 60;

const SNAPSHOT_LABEL = {
  targetMinutes: "소정근로",
  workedMinutes: "실근무",
  nightMinutes: "야간",
  holidayMinutes: "휴일근무",
  overtimeMinutes: "법정초과",
  avgWeeklyMinutes: "주평균",
} as const;

const label = dateLabel;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; msg?: string; err?: string }>;
}) {
  const { period, msg, err } = await searchParams;
  const viewer = await requestViewer("/");
  const rules = await loadOrgRules(viewer.orgId);
  const zone = rules.attendance.timezone;

  const asOf = now();
  const asOfDate = DateTime.fromJSDate(asOf, { zone }).toISODate()!;
  const opts = {
    kind: rules.settlementKind,
    weekStartDay: rules.weekStartDay,
    timezone: zone,
  };
  const range = resolvePeriod(period ?? asOfDate, opts);
  const currentRange = resolvePeriod(asOfDate, opts);
  const isCurrent = range.start === currentRange.start;

  const days = await loadWorkDays(viewer, viewer.id, range);
  const off = await loadTimeOff(viewer, viewer.id, range);

  const summary = computePeriodSummary(
    {
      periodStart: range.start,
      periodEnd: range.end,
      days,
      timeOff: off,
      asOf,
      // 개인 집계·적용기간 = 조직 정산기간 ∩ 근로관계 존속기간
      employment: { hiredAt: viewer.hiredAt, resignedAt: viewer.resignedAt },
    },
    rules.settlement,
  );

  /*
   * 날짜 목록은 개인 집계기간(= 조직 정산기간 ∩ 근로관계 존속기간)이다.
   *
   * 입사 전 빈 날짜를 보여주면 "입사 전인데 안 일했다"로 읽히고, 주차 줄까지
   * 만들어져서 없는 미달이 생긴다. 그래서 빼는데 — 기록이 **있는** 날은 뺄 수
   * 없다. 원본을 화면에서 지우면 입사일이 틀렸다는 사실을 아무도 모른다.
   * (집계에는 안 들어간다. settle.ts 가 교집합으로 잘라낸다.)
   */
  const outsideWithRecord = days
    .filter(
      (d) =>
        d.tagCount > 0 &&
        (d.workDate < summary.applicableStart ||
          d.workDate > summary.applicableEnd),
    )
    .map((d) => d.workDate);
  const dates = [
    ...new Set([
      ...(summary.employed
        ? eachDate(summary.applicableStart, summary.applicableEnd, zone)
        : []),
      ...outsideWithRecord,
    ]),
  ].sort();
  const outsideDates = new Set(outsideWithRecord);
  const byDate = new Map<string, ComputedDay>(days.map((d) => [d.workDate, d]));
  const offByDate = new Map(off.map((o) => [o.date, o]));

  // 마감된 기간은 스냅샷이 공식 기록이다. 지금 재계산한 값과 다르면
  // 늦게 온 태그나 설정 변경이 있었다는 뜻이므로 드러낸다.
  const periodState = await loadPeriodState(
    viewer.orgId,
    viewer.id,
    range,
    summary,
  );

  /**
   * 오늘 카드.
   *
   * "오늘 몇 시에 퇴근해도 되나" — 자율출근제 직원이 매일 갖는 질문이고,
   * 앱을 여는 이유다. 앱에서 근무 시작을 받으니 이제 답할 수 있다.
   */
  const todayDay = byDate.get(asOfDate) ?? null;
  const todayMinutes = todayDay
    ? minutesIncludingOpen(todayDay, rules.attendance, asOf)
    : 0;
  // 어제 종료를 깜빡한 근무. 이게 남아 있으면 새 근무를 시작할 수 없으므로
  // 버튼을 눌러서 알게 되는 게 아니라 카드에 먼저 띄운다.
  const dangling = isCurrent ? await danglingSession(viewer.id, rules) : null;
  const isTodayBusiness =
    !rules.attendance.weekendDays.includes(
      DateTime.fromJSDate(asOf, { zone }).weekday,
    ) && !rules.attendance.holidays.includes(asOfDate);

  const paceGap = summary.projectedMinutes - summary.targetMinutes;
  const paceNote =
    summary.paceStatus === "behind"
      ? `이 페이스면 ${hm(-paceGap)} 부족`
      : summary.paceStatus === "ahead"
        ? `이 페이스면 ${hm(paceGap)} 초과`
        : "목표대로 가고 있음";

  /**
   * 주 정산에서는 "남은 시간 / 남은 일수"가 페이스보다 직관적이다.
   * 남은 일수가 1~5일이면 사람이 머리로 나눌 수 있고, "하루 몇 시간"이
   * 바로 행동 신호가 된다. 페이스는 정산기간이 월일 때 값어치가 생긴다.
   */
  const remainingBusinessDates = dates.filter((date) => {
    if (date < asOfDate) return false;
    const dt = DateTime.fromISO(date, { zone });
    return (
      !rules.attendance.weekendDays.includes(dt.weekday) &&
      !rules.attendance.holidays.includes(date)
    );
  });

  const requiredPerDay =
    summary.remainingBusinessDays > 0
      ? Math.ceil(summary.remainingMinutes / summary.remainingBusinessDays)
      : 0;
  const dailyLimit = rules.attendance.dailyLimitMinutes;
  const unreachable =
    dailyLimit !== null &&
    summary.remainingMinutes > 0 &&
    requiredPerDay > dailyLimit;

  const nextDow = remainingBusinessDates[0]
    ? label(remainingBusinessDates[0], zone).dow
    : null;

  // 달성이 불가능하면 "하루 40시간 필요" 같은 숫자를 보여주지 않는다.
  // 물리적으로 불가능한 값을 요구하는 화면은 사용자를 조롱하는 것에 가깝다.
  const remainingLabel =
    summary.remainingBusinessDays === 0
      ? "영업일이 모두 지났습니다 — 이번 정산기간에는 더 채울 수 없습니다"
      : unreachable
        ? `영업일 ${summary.remainingBusinessDays}일 남음 — 1일 상한(${hm(dailyLimit!)})으로는 채울 수 없습니다`
        : summary.remainingBusinessDays === 1 && nextDow
          ? `${nextDow}요일 하루 남음 — 하루 ${hm(requiredPerDay)} 필요`
          : `영업일 ${summary.remainingBusinessDays}일 남음 — 하루 ${hm(requiredPerDay)} 필요`;

  // 오늘 채워야 하는 몫과, 그러려면 언제 종료하면 되는지
  const neededToday = Math.max(0, requiredPerDay - todayMinutes);

  /*
   * 채울 수 없는 기간이면 오늘 카드도 그걸 알아야 한다.
   *
   * 위 remainingLabel 은 unreachable 을 보고 문구를 바꾸는데 오늘 카드는 안
   * 봤다. 그래서 "오늘 26시간 40분 채우면 목표에 맞습니다" 바로 아래에
   * "채울 수 없습니다"가 붙었다 — 같은 화면의 두 카드가 서로를 부정했다.
   *
   * 오늘 몫 대신 기간 사실을 넘긴다. 상한을 오늘 몫 자리에 넣으면 "채워라"로
   * 읽혀서 과로를 권하는 신호가 된다 (today-card.tsx 의 cannotFill 주석).
   *
   * maxAdditional 에서 오늘 실적을 뺀다 — 남은 영업일에 오늘이 포함되는데
   * 오늘 몫은 이미 workedMinutes 에 들어가 remainingMinutes 를 줄였으므로,
   * 안 빼면 같은 시간을 두 번 세어 부족분이 작게 나온다.
   */
  const cannotFill =
    unreachable && dailyLimit !== null
      ? (() => {
          const capacity = summary.remainingBusinessDays * dailyLimit;
          const maxAdditional = Math.max(
            0,
            capacity - (isTodayBusiness ? todayMinutes : 0),
          );
          return {
            maxAdditional,
            shortfall: Math.max(0, summary.remainingMinutes - maxAdditional),
            target: summary.targetMinutes,
            businessDays: summary.remainingBusinessDays,
          };
        })()
      : null;
  const leaveAt = todayDay?.openSince
    ? leaveTimeFor({
        openSince: todayDay.openSince,
        asOf,
        neededMinutes: neededToday,
        rules: rules.attendance,
      })
    : null;

  const todayView = {
    isWorking: Boolean(todayDay?.openSince),
    openSince: todayDay?.openSince ?? null,
    sessionCount: todayDay
      ? todayDay.sessionCount - (todayDay.openSince ? 1 : 0)
      : 0,
    todayMinutes,
    neededToday,
    cannotFill,
    leaveAt,
    leaveCrossesMidnight: leaveAt
      ? DateTime.fromJSDate(leaveAt, { zone }).toISODate() !== asOfDate
      : false,
    note: !isTodayBusiness
      ? "오늘은 영업일이 아닙니다. 일한 시간은 휴일 근무로 집계됩니다."
      : summary.remainingMinutes === 0
        ? "이번 정산기간 목표를 이미 채웠습니다."
        : null,
    dangling: dangling
      ? { workDate: dangling.workDate, startedAt: dangling.startedAt }
      : null,
    zone,
  };

  const core = rules.attendance.coreTime;
  const from = DateTime.fromISO(range.start, { zone });
  const to = DateTime.fromISO(range.end, { zone });
  // 실제 데이터에서 뽑는다. "기준시각 - 1일"로 두면 임포트가 늦거나 빠를 때
  // 화면이 거짓말을 한다.
  const lastRecorded = days.filter((d) => d.tagCount > 0).at(-1)?.workDate;
  const importedThrough = lastRecorded
    ? `근태 기록은 ${DateTime.fromISO(lastRecorded, { zone }).toFormat("M월 d일")}까지 들어와 있음`
    : "이 기간에 들어온 근태 기록이 없음";

  /**
   * 일별 근무 한 줄.
   *
   * 주차로 묶으면서 같은 줄을 두 곳(묶음 안 / 안 묶을 때)에서 쓰게 되어
   * 함수로 뺐다.
   */
  const dayRow = (date: string) => {
    const d = byDate.get(date);
    const l = label(date, zone);
    const dayOff = offByDate.get(date);
    const weekend = rules.attendance.weekendDays.includes(
      DateTime.fromISO(date, { zone }).weekday,
    );
    const width = d
      ? Math.min(100, (d.workMinutes / SCALE_MINUTES) * 100)
      : 0;
    const overLimit = d?.flags.includes("over_daily_limit");

    /** 오른쪽에 쓸 값. 시간이 없으면 왜 없는지를 쓴다. */
    const value =
      d && d.status === "open" ? (
        <>
          {hm(minutesIncludingOpen(d, rules.attendance, asOf))}
          <span className="note">근무 중</span>
        </>
      ) : d && d.status === "incomplete" ? (
        <span className="warn">퇴근 기록 없음</span>
      ) : d ? (
        <>
          {hm(d.workMinutes)}
          {d.sessionCount > 1 && (
            <span className="note">{d.sessionCount}번 나눠</span>
          )}
        </>
      ) : dayOff ? (
        <span className="off">{OFF_LABEL[dayOff.kind]}</span>
      ) : (
        <span className="off">{date > asOfDate ? "—" : "기록 없음"}</span>
      );

    // 재직 구간 밖인데 기록이 있는 날. 집계에서 빠졌다는 걸 그 줄에서 말한다 —
    // 안 적으면 숫자가 안 맞는 이유를 화면 어디서도 알 수 없다.
    const outside = outsideDates.has(date);

    return (
      <li key={date} className={weekend ? "we" : undefined}>
        <div className="d">
          {l.md} <span>({l.dow})</span>
        </div>
        <div
          className="prog"
          role="img"
          aria-label={d ? `실근무 ${hm(d.workMinutes)}` : "근무 기록 없음"}
        >
          {width > 0 && (
            <span
              className={
                overLimit
                  ? "fill over"
                  : d?.status === "open"
                    ? "fill open"
                    : "fill"
              }
              style={{ width: `${width}%` }}
            />
          )}
          {/*
            눈금 = 1일 소정근로. 없으면 막대가 많은지 적은지 모른다.
            아직 오지 않은 날에는 그리지 않는다 — 안 지난 날에 기준선을
            두면 "여기까지 못 채웠다"로 읽힌다.
          */}
          {date <= asOfDate && (
            <i
              className="tick"
              style={{
                left: `${(REFERENCE_MINUTES / SCALE_MINUTES) * 100}%`,
              }}
            />
          )}
        </div>
        <div className="v">
          {value}
          {outside && <span className="warn">재직 기간 밖 · 집계 제외</span>}
        </div>
      </li>
    );
  };

  /*
   * 주차로 묶는다.
   *
   * 월 정산이면 31행이 한 줄로 늘어서서 읽히지 않는다. 주 경계는 조직의
   * 주 시작일을 따르고, 정산기간을 넘지 않게 그 안의 날짜만 담는다 —
   * 7월 1일이 수요일이면 첫 주는 3일짜리 조각이 되는 게 맞다.
   * 억지로 6월과 합치면 이 화면이 정산기간 밖을 보여주게 된다.
   */
  const weekGroups: {
    key: string;
    /** "3주차" — 정산기간 안에서 몇 번째 주인지 */
    ord: string;
    /** "7/13~7/19" */
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
    let g = weekGroups.find((x) => x.key === w.start);
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
      weekGroups.push(g);
    }
    g.dates.push(date);
    const d = byDate.get(date);
    if (d) {
      g.workedMinutes += d.workMinutes;
      // 접힌 주에도 확인할 것이 있으면 요약에 남긴다
      if (d.status === "incomplete" || d.flags.length > 0) g.attention += 1;
    }
    if (date === asOfDate) g.hasToday = true;
  }
  /*
   * 라벨을 주차 번호로 통일한다.
   *
   * 전에는 "7/1 ~ 7/5 · 5일" 처럼 썼는데, 조각 주 때문에 "5일 / 7일" 이 섞이고
   * 날짜 문자열 폭도 달라서 접힌 줄들이 들쭉날쭉했다. 일수는 날짜 범위가 이미
   * 말해주므로 지운다. 월 정산에서 사람이 쓰는 단위가 "몇 주차"다.
   */
  weekGroups.forEach((g, i) => {
    g.ord = `${i + 1}주차`;
    const from = label(g.dates[0], zone);
    const to = label(g.dates[g.dates.length - 1], zone);
    // 같은 달이면 뒤쪽 월을 지운다 ("7/13~7/19" → "7/13~19"). 390px 에서
    // 확인 배지까지 한 줄에 들어가려면 이 26px 가 필요했다.
    const sameMonth = from.md.split("/")[0] === to.md.split("/")[0];
    g.span =
      g.dates.length === 1
        ? from.md
        : `${from.md}~${sameMonth ? to.md.split("/")[1] : to.md}`;
  });

  return (
    <main className="page">
      <div className="head">
        <h1>{viewer.name}</h1>
        <span className="team">{viewer.teamName ?? rules.orgName}</span>
        {periodState.status === "closed" && (
          <span className="chip">
            마감됨
            {periodState.closedAt &&
              ` · ${DateTime.fromJSDate(periodState.closedAt, { zone }).toFormat("M/d")}`}
          </span>
        )}
        {isFixedClock() && <span className="chip">고정 시계 (개발)</span>}
      </div>
      <p className="sub">
        <PeriodNav
          basePath="/"
          range={range}
          kind={rules.settlementKind}
          weekStartDay={rules.weekStartDay}
          timezone={zone}
          isCurrent={isCurrent}
        />
        <br />
        <span className="dim">
          {rules.settlementKind === "week" ? "주" : "월"} 단위 정산 ·{" "}
          {importedThrough}
        </span>
        {/*
          부분 재직이면 재직 구간을 병기한다. 같은 "7월"이 사람마다 다른 구간을
          뜻하게 되므로 이걸 안 적으면 아래 숫자를 남과 맞춰볼 수 없다.
        */}
        {summary.partialEmployment && (
          <>
            <br />
            <span className="dim">
              재직 {label(summary.applicableStart, zone).md}
              {summary.applicableEnd === range.end
                ? "~"
                : `~${label(summary.applicableEnd, zone).md}`}{" "}
              — 소정근로와 주 평균이 이 구간으로 계산됩니다
            </span>
          </>
        )}
      </p>

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
        재직 기간이 아니면 여기서 끝낸다.
        0 을 그리면 "안 일했다"로 읽혀서 없는 미달이 생긴다 — 입사도 안 한 달에
        "176시간 미달" 판정을 받는 화면이 실제로 나왔다. 교집합이 비었다는 건
        숫자가 0이라는 뜻이 아니라 그 정산기간이 그 사람에게 없다는 뜻이다.
      */}
      {!summary.employed ? (
        <section className="card hero">
          <div className="label">
            {label(range.start, zone).md} ~ {label(range.end, zone).md}
          </div>
          <div className="figure">재직 기간이 아닙니다</div>
          <div className="note">
            {viewer.hiredAt && range.end < viewer.hiredAt
              ? `${label(viewer.hiredAt, zone).md} 입사 — 그 전 정산기간에는 근태가 없습니다.`
              : viewer.resignedAt && range.start > viewer.resignedAt
                ? `${label(viewer.resignedAt, zone).md} 까지 재직 — 그 뒤 정산기간에는 근태가 없습니다.`
                : "이 정산기간에는 재직 기록이 없습니다."}
          </div>
        </section>
      ) : (
        <>
      {/* 오늘 카드는 이번 기간을 볼 때만. 지난 기간에 근무 시작 버튼은 뜻이 없다 */}
      {isCurrent && <TodayCard view={todayView} />}

      {/*
        히어로 우선순위: 법정 위반 > 목표 달성 > 남은 시간.
        52시간 초과는 위법 소지인데 "목표 달성" 축하 화면에 묻히면 안 된다.
        실제로 존재하는 숫자만 1급으로 둔다 (예측값은 아래 타일로).

        예측(exceedsLimitEvenIfScheduledOnly)으로 칸을 하나 더 만들지는 않았다.
        예측은 주말마다 켜졌다 꺼진다 (settle.ts 의 오늘 겹침) — 최상단으로
        올리면 화면에서 가장 큰 요소가 주 단위로 깜빡인다. 대신 2칸 안에서
        배지와 숫자로만 말한다. 같은 행동을 요구하므로 칸을 가를 필요가 없다.
      */}
      <section className="card hero">
        {summary.exceedsAvgWeeklyLimit ? (
          <>
            <div className="label">주 평균 근로시간</div>
            <div className="figure">{hm(summary.avgWeeklyMinutes)}</div>
            <div className="status crit">
              <span className="dot" aria-hidden="true" />
              법정 한도 52시간 초과
            </div>
            <div className="note">
              누적 {hm(summary.workedMinutes)} · 법정 초과{" "}
              {hm(summary.overtimeMinutes)}. 남은 기간 근무를 줄이고 팀장과
              조정하세요.
            </div>
          </>
        ) : summary.remainingMinutes === 0 ? (
          <>
            {/*
              목표를 채운 사람에게도 한도 위험이 있을 수 있다.
              김도윤 실측 — 채웠습니다(초록) 밑에서 예상 주평균 54시간 16분이
              빨강이고, 확정 법정초과가 31시간 58분 쌓여 있었다. 그런데 그
              숫자는 위 1칸 안에만 있어서 본인 화면에 아예 안 나왔다.

              칸을 따로 만들어 초록을 밀어내지는 않는다. 두 메시지가 요구하는
              행동이 **같기 때문**이다 — "채웠으니 더 안 해도 된다"와 "이대로면
              넘으니 줄여라"는 둘 다 덜 일하라는 말이다. 가를 게 아니라 한 번에
              말하면 된다. 대신 배지를 축하에서 주의로 바꾸고, 없던 숫자를 넣는다.
            */}
            <div className="label">이번 정산기간 소정근로</div>
            <div className="figure">채웠습니다</div>
            {summary.exceedsLimitEvenIfScheduledOnly ? (
              <div className="status warn">
                <span className="dot" aria-hidden="true" />
                여기서 줄이세요 · 이대로면 주 평균{" "}
                {hm(rules.settlement.maxAvgWeeklyMinutes)} 초과
              </div>
            ) : (
              <div className="status good">
                <span className="dot" aria-hidden="true" />
                목표 달성
              </div>
            )}
            <div className="note">
              누적 {hm(summary.workedMinutes)} / 목표{" "}
              {hm(summary.targetMinutes)}
              {/*
                법정초과는 willExceed 와 무관하게 보여준다. 소정근로가 법정
                총량보다 큰 달(7월은 목표 184시간 vs 법정 총량 177시간 9분)에는
                목표만 정확히 채워도 연장근로가 생긴다. 그 사실이 화면에
                없으면 본인은 모르고 급여 쪽에서만 안다.
              */}
              {summary.overtimeMinutes > 0 &&
                ` · 법정초과 ${hm(summary.overtimeMinutes)}`}
            </div>
          </>
        ) : (
          <>
            <div className="label">남은 시간</div>
            <div className="figure">{hm(summary.remainingMinutes)}</div>
            {unreachable && (
              <div className="status warn">
                <span className="dot" aria-hidden="true" />
                남은 영업일로는 채울 수 없습니다
              </div>
            )}
            <div className="note">{remainingLabel}</div>
          </>
        )}
      </section>

      <section className="card">
        <div className="tiles">
          <div className="tile">
            <div className="k">누적</div>
            <div className="v">{hm(summary.workedMinutes)}</div>
          </div>
          <div className="tile">
            <div className="k">소정근로</div>
            <div className="v">{hm(summary.targetMinutes)}</div>
            {/*
              휴가로 줄어든 목표는 왜 줄었는지 같이 말한다. 안 적으면 옆자리는
              184시간인데 나는 180시간이고 그 이유가 화면에 없다 — 계약
              소정근로인지 휴가 반영 후 값인지도 구분되지 않는다.
            */}
            {summary.approvedLeaveMinutes > 0 && (
              <div className="k" style={{ marginTop: 2 }}>
                계약 {hm(summary.scheduledTargetMinutes)} · 휴가{" "}
                {hm(summary.approvedLeaveMinutes)} 차감
              </div>
            )}
          </div>
          {/* 목표를 채웠으면 페이스는 의미가 없다. 두 메시지가 모순되면 안 된다. */}
          <div className="tile">
            <div className="k">이 페이스면</div>
            {summary.remainingMinutes === 0 ? (
              <>
                <div className="v">—</div>
                <div className="k" style={{ marginTop: 2 }}>
                  목표를 이미 채웠음
                </div>
              </>
            ) : (
              <>
                <div className="v">{hm(summary.projectedMinutes)}</div>
                <div className="k" style={{ marginTop: 2 }}>
                  {paceNote}
                </div>
              </>
            )}
          </div>
          {/*
            주 52시간은 정산기간 평균으로 판정하므로(§52) 기간 중의
            avgWeeklyMinutes 는 분모가 기간 전체라 항상 낮게 나온다. 3월 첫 주에
            70시간을 일해도 15시간대로 나오는 값을 "주평균"으로 보여주면
            안심시킨다. 사람이 지금 행동할 근거는 예상치 쪽이다.
            주 정산에서는 위 "이 페이스면"이 곧 주평균이라 중복이므로 뺀다.
          */}
          {rules.settlementKind === "month" && (
            <div className="tile">
              <div className="k">예상 주평균</div>
              {summary.elapsedBusinessDays === 0 ? (
                <>
                  <div className="v">—</div>
                  <div className="k" style={{ marginTop: 2 }}>
                    아직 페이스가 없음
                  </div>
                </>
              ) : (
                <>
                  {/* 한도를 넘긴 예상치는 색으로도 말한다 */}
                  <div
                    className={
                      summary.projectedAvgWeeklyMinutes >
                      rules.settlement.maxAvgWeeklyMinutes
                        ? "v over"
                        : "v"
                    }
                  >
                    {hm(summary.projectedAvgWeeklyMinutes)}
                  </div>
                  <div className="k" style={{ marginTop: 2 }}>
                    한도 {hm(rules.settlement.maxAvgWeeklyMinutes)}
                  </div>
                </>
              )}
            </div>
          )}
          <div className="tile">
            <div className="k">야간 근무</div>
            <div className="v">{hm(summary.nightMinutes)}</div>
          </div>
        </div>
        <div className="meter">
          <span
            style={{
              width: `${
                summary.targetMinutes
                  ? Math.min(
                      100,
                      (summary.workedMinutes / summary.targetMinutes) * 100,
                    )
                  : 0
              }%`,
            }}
          />
        </div>
        <div className="meter-legend">
          <span>{hm(summary.workedMinutes)}</span>
          <span>목표 {hm(summary.targetMinutes)}</span>
        </div>
      </section>

      <section className="card">
        <h2>확인 필요</h2>
        {summary.incompleteDates.length === 0 &&
        summary.flaggedDates.length === 0 &&
        summary.timeOffConflicts.length === 0 &&
        !summary.exceedsAvgWeeklyLimit &&
        !summary.exceedsLimitEvenIfScheduledOnly &&
        !periodState.diff?.changed &&
        (periodState.diff?.comparable ?? true) ? (
          <p className="empty">확인할 항목이 없습니다.</p>
        ) : (
          <ul className="issues">
            {/*
              계산 기준이 바뀐 기간은 값을 비교하지 않는다. 차이가 나도 그건
              근태가 바뀐 게 아니라 기준이 바뀐 것이라 "마감 후 변경"이 아니다.
              숨기지 않고 상태로 말한다 — 왜 비교가 없는지 알려줘야 한다.
            */}
            {periodState.diff && !periodState.diff.comparable && (
              <li>
                <span className="icon warn" aria-hidden="true">
                  !
                </span>
                <span>
                  <span className="what">
                    계산 기준이 변경되어 현재 값과 직접 비교하지 않습니다
                  </span>
                  <br />
                  <span className="why">
                    이 기간은 계산 기준 {periodState.diff.snapshotCalcVersion}
                    으로 마감됐고 지금은{" "}
                    {periodState.diff.currentCalcVersion} 입니다. 공식 기록은
                    마감 시점 값입니다.
                  </span>
                </span>
              </li>
            )}
            {periodState.diff?.changed && (
              <li>
                <span className="icon crit" aria-hidden="true">
                  !
                </span>
                <span>
                  <span className="what">마감 후 값이 바뀌었습니다</span>
                  <br />
                  <span className="why">
                    {Object.entries(periodState.diff.deltas)
                      .map(
                        ([key, delta]) =>
                          `${SNAPSHOT_LABEL[key as keyof typeof SNAPSHOT_LABEL]} ${delta > 0 ? "+" : "−"}${hm(Math.abs(delta))}`,
                      )
                      .join(" · ")}
                    . 공식 기록은 마감 시점 값이며, 반영이 필요하면 HR에
                    재마감을 요청하세요.
                  </span>
                </span>
              </li>
            )}
            {summary.exceedsAvgWeeklyLimit && (
              <li>
                <span className="icon crit" aria-hidden="true">
                  !
                </span>
                <span>
                  <span className="what">주 평균 52시간 초과</span>
                  <br />
                  <span className="why">
                    정산기간 평균 {hm(summary.avgWeeklyMinutes)} — 법정 한도를
                    넘었습니다.
                  </span>
                </span>
              </li>
            )}
            {/*
              확정 초과(위)는 "남은 날을 전부 쉬어도 되돌릴 수 없다"는 뜻이라
              정확하지만 늦게 켜진다. 매일 14시간이면 정산기간이 3/4 지난 뒤다.
              그 앞 구간을 하한으로 채운다 — 페이스 외삽이 아니라 "소정근로만
              해도 넘는다"이므로 임의 문턱이 없고 반박도 되지 않는다.

              이 경고는 본인 화면에만 둔다. 팀 현황·전사 집계는 확정만 본다.
              예상 위법이 관리자 화면에 뜨면 지목된 사람이 줄이는 게 근무가
              아니라 기록일 수 있다 (자기신고에 불이익을 붙이는 설계).
            */}
            {!summary.exceedsAvgWeeklyLimit &&
              summary.exceedsLimitEvenIfScheduledOnly && (
                <li>
                  <span className="icon crit" aria-hidden="true">
                    !
                  </span>
                  <span>
                    <span className="what">
                      이대로면 주 평균{" "}
                      {hm(rules.settlement.maxAvgWeeklyMinutes)}을 넘습니다
                    </span>
                    <br />
                    <span className="why">
                      누적 {hm(summary.workedMinutes)} · 남은 영업일{" "}
                      {summary.remainingBusinessDays}일에 소정근로{" "}
                      {hm(summary.remainingScheduledMinutes)}만 더해도 법정
                      한도를 넘습니다. 남은 기간 근무를 줄이거나 팀장과
                      조정하세요.
                    </span>
                  </span>
                </li>
              )}
            {summary.incompleteDates.map((date) => {
              const l = label(date, zone);
              const d = byDate.get(date);
              return (
                <li key={date}>
                  <span className="icon warn" aria-hidden="true">
                    !
                  </span>
                  <span>
                    <span className="what">
                      {l.md}({l.dow}) 퇴근 기록 없음
                    </span>
                    <br />
                    <span className="why">
                      {clock(d?.firstInAt ?? null, zone)} 출근 기록만 있습니다.
                      집계에서 빠져 있습니다. <Link href="/records">보정하기</Link>
                    </span>
                  </span>
                </li>
              );
            })}
            {summary.flaggedDates.map(({ date, flags }) => {
              const l = label(date, zone);
              const d = byDate.get(date);
              return (
                <li key={`f-${date}`}>
                  <span className="icon warn" aria-hidden="true">
                    !
                  </span>
                  <span>
                    <span className="what">
                      {l.md}({l.dow}){" "}
                      {flags.map((f) => FLAG_LABEL[f]).join(", ")}
                    </span>
                    <br />
                    <span className="why">
                      {d && d.sessionCount > 1
                        ? `${d.sessionCount}번 나눠 근무 · 실근무 ${hm(d.workMinutes)}`
                        : `${clock(d?.firstInAt ?? null, zone)}~${clock(d?.lastOutAt ?? null, zone)} 근무`}
                      {core
                        ? ` · 의무근로시간대는 ${core.start}~${core.end}입니다.`
                        : ""}
                    </span>
                  </span>
                </li>
              );
            })}
            {summary.timeOffConflicts.map((date) => {
              const l = label(date, zone);
              return (
                <li key={`t-${date}`}>
                  <span className="icon warn" aria-hidden="true">
                    !
                  </span>
                  <span>
                    <span className="what">
                      {l.md}({l.dow}) 휴가일에 근무 기록
                    </span>
                    <br />
                    <span className="why">
                      휴가로 등록된 날에 출입 기록이 있습니다.
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/*
        일별 근무 — 가로 목록.
        세로 막대는 툴팁이 hover 라서 폰에서 숫자를 볼 수 없었다. 주 정산이면
        7칸이라 버티지만 월 정산이면 31칸이 실오라기가 된다. 가로로 두면
        날짜·막대·시간·상태가 한 줄에 같이 들어가서 툴팁이 필요 없다.
      */}
      <section className="card">
        <h2>일별 근무</h2>
        {weekGroups.length <= 1 ? (
          <ul className="daybars">{dates.map(dayRow)}</ul>
        ) : (
          /*
            월 정산이면 31행이 된다. 주차로 묶고 오늘이 든 주만 펼친다.
            접힌 주에도 확인할 것이 있으면 요약에 표시를 남긴다 — 안 그러면
            지난 주 미완료가 숨는다.
          */
          weekGroups.map((g) => (
            <details className="weekgroup" key={g.key} open={g.hasToday}>
              {/*
                합계를 맨 끝에 둔다. 배지·칩을 합계 뒤에 두면 그 폭만큼
                합계가 왼쪽으로 밀려서 줄마다 열이 어긋났다.
              */}
              <summary>
                <span className="ord">{g.ord}</span>
                <span className="span">{g.span}</span>
                {/*
                  배지는 "접혀서 안 보이는데 확인할 게 있다"는 신호다. 펼쳐진
                  이번 주에는 아래 줄에 그대로 보이니 붙이지 않는다. 덕분에
                  배지와 "이번 주"가 한 줄에 겹치는 경우가 없어진다.
                */}
                {g.attention > 0 && !g.hasToday && (
                  <span className="badge">확인 {g.attention}</span>
                )}
                {g.hasToday && <span className="now">이번 주</span>}
                <span className="sum">{hm(g.workedMinutes)}</span>
              </summary>
              <ul className="daybars">{g.dates.map(dayRow)}</ul>
            </details>
          ))
        )}
        <p className="empty" style={{ marginTop: 12 }}>
          눈금은 1일 소정근로 {hm(REFERENCE_MINUTES)}입니다. 자율 출근제는
          하루가 아니라 정산기간 총량으로 맞추면 됩니다.
        </p>
      </section>


      {/* 정확한 숫자는 접어 둔다. 색에만 의존하지 않기 위해 표를 없애지 않는다 */}
      <details className="fold" style={{ marginBottom: 14 }}>
        <summary>숫자로 보기</summary>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>날짜</th>
                {/*
                  나눠 일한 날이 있으므로 "출근/퇴근"이라고 쓰면 안 된다.
                  09~12 + 19~21 인 날의 09 와 21 은 하루의 양끝일 뿐이고,
                  그 사이를 근무로 읽으면 안 된다 — 실근무 열이 정답이다.
                */}
                <th>첫 시작</th>
                <th>마지막 종료</th>
                <th>체류</th>
                <th>휴게</th>
                <th>실근무</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {dates.map((date) => {
                const d = byDate.get(date);
                const l = label(date, zone);
                const dayOff = offByDate.get(date);
                if (!d) {
                  return (
                    <tr key={date}>
                      <td>
                        {l.md} ({l.dow})
                      </td>
                      {/*
                        휴가를 안 쓰면 연차 쓴 날이 "기록 없음"으로 남아서,
                        쉰 날인지 사원증을 안 찍은 날인지 구분되지 않는다.
                      */}
                      <td colSpan={5} className="none">
                        {dayOff ? OFF_LABEL[dayOff.kind] : "기록 없음"}
                      </td>
                      <td />
                    </tr>
                  );
                }
                return (
                  <tr key={date}>
                    <td>
                      {l.md} ({l.dow})
                    </td>
                    <td>{clock(d.firstInAt, zone) ?? "—"}</td>
                    <td>{clock(d.lastOutAt, zone) ?? "—"}</td>
                    <td>{d.stayMinutes ? hm(d.stayMinutes) : "—"}</td>
                    <td>{d.autoBreakMinutes ? hm(d.autoBreakMinutes) : "—"}</td>
                    <td>
                      {d.status === "incomplete" ? "—" : hm(d.workMinutes)}
                    </td>
                    <td>
                      {dayOff && (
                        <span className="tag">{OFF_LABEL[dayOff.kind]}</span>
                      )}
                      {d.status === "incomplete" && (
                        <span className="tag">미완료</span>
                      )}
                      {d.status === "open" && (
                        <span className="tag">근무 중</span>
                      )}
                      {d.sessionCount > 1 && (
                        <span className="tag">{d.sessionCount}번 나눠 근무</span>
                      )}
                      {d.flags.map((f) => (
                        <span className="tag" key={f}>
                          {FLAG_LABEL[f]}
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="scroll-hint">
          표를 옆으로 밀면 체류 · 휴게 · 실근무 · 비고가 있습니다.
        </p>
      </details>
        </>
      )}
    </main>
  );
}
