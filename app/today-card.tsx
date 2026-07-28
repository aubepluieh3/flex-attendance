import Link from "next/link";
import { DateTime } from "luxon";
import { startWorkAction, stopWorkAction } from "./work-actions";
import { hm } from "@/lib/format";

/**
 * 오늘 카드 — 앱을 여는 이유.
 *
 * "오늘 몇 시에 퇴근해도 되나"가 자율출근제 직원이 매일 갖는 질문이다.
 * 근무 시작을 앱에서 받으면 그 질문에 답할 수 있다.
 */
export type TodayView = {
  isWorking: boolean;
  /** 진행 중 세션 시작 시각 */
  openSince: Date | null;
  /** 오늘 확정된 세션 수 */
  sessionCount: number;
  /** 오늘 지금까지 (진행 중 포함) */
  todayMinutes: number;
  /** 오늘 채워야 하는 시간 (남은 시간 ÷ 남은 영업일) */
  neededToday: number;
  /** 지금 페이스로 목표를 맞추려면 언제 퇴근하면 되는지 */
  leaveAt: Date | null;
  /** 그 시각이 다음 날로 넘어가는지 */
  leaveCrossesMidnight: boolean;
  /** 오늘이 영업일이 아니거나 이미 목표를 채웠다 */
  note: string | null;
  /** 지난 날 종료를 깜빡한 근무. 있으면 새 근무를 시작할 수 없다. */
  dangling: { workDate: string; startedAt: Date } | null;
  zone: string;
};

export function TodayCard({ view }: { view: TodayView }) {
  const clock = (d: Date) =>
    DateTime.fromJSDate(d, { zone: view.zone }).toFormat("HH:mm");

  /**
   * 어제 종료를 깜빡했으면 그것부터 해결해야 한다.
   *
   * 안 알려주면 "근무 시작"을 눌렀다가 "이미 근무 중입니다"만 튀어나온다 —
   * 화면은 시작 전이라고 말하면서 버튼은 거부하는 상태가 된다.
   */
  if (view.dangling) {
    return (
      <section className="card hero">
        <div className="label">
          {DateTime.fromISO(view.dangling.workDate, {
            zone: view.zone,
          }).toFormat("M월 d일")}{" "}
          근무가 아직 종료되지 않았습니다
        </div>
        <div className="figure">{clock(view.dangling.startedAt)} 시작</div>
        <div className="status warn">
          <span className="dot" aria-hidden="true" />
          종료 시각 없음
        </div>
        <div className="note">
          그날 몇 시에 마쳤는지 넣어야 근무시간이 집계됩니다. 이걸 정리하기
          전에는 새 근무를 시작할 수 없습니다.
        </div>
        <p style={{ marginTop: 16 }}>
          {/*
            period 를 붙여야 한다. 방치된 세션이 지난 정산기간에 있으면
            기본(이번 기간) 화면에는 그 날이 없어서 종료 폼도 안 보인다.
          */}
          {/*
            period 로 그 정산기간을, 해시로 그 날 카드까지 내려간다. 링크가
            페이지 맨 위에 떨어뜨리면 2천 픽셀을 스크롤해서 찾아야 한다.
          */}
          <Link
            href={`/records?period=${view.dangling.workDate}#${view.dangling.workDate}`}
          >
            기록에서 종료 시각 넣기
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className="card hero">
      {view.isWorking ? (
        <>
          <div className="label">
            오늘 근무 중 · {view.openSince ? clock(view.openSince) : ""} 시작
            {view.sessionCount > 0 && ` (오늘 ${view.sessionCount + 1}번째)`}
          </div>
          <div className="figure">{hm(view.todayMinutes)}</div>
          <div className="status good">
            <span className="dot" aria-hidden="true" />
            근무 중
          </div>
          {/*
            자정을 넘기는 시각을 "03:36에 종료하면"이라고만 쓰면 새벽 3시까지
            일하라는 말로 읽힌다. 오늘 안에 못 채우는 건 정상이므로(정산은
            기간 총량 기준) 그렇다고 말하고 남은 날에 나누게 한다.
          */}
          <div className="note">
            {view.leaveAt
              ? view.leaveCrossesMidnight
                ? `오늘 몫(${hm(view.neededToday)})을 다 채우려면 다음 날 ${clock(view.leaveAt)}까지 걸립니다. 정산은 기간 총량 기준이니 남은 날에 나눠도 됩니다.`
                : `${clock(view.leaveAt)}에 종료하면 오늘 몫(${hm(view.neededToday)})을 채웁니다.`
              : (view.note ?? "오늘 채울 몫은 없습니다.")}
          </div>
          <form action={stopWorkAction} style={{ marginTop: 16 }}>
            <button type="submit">근무 종료</button>
          </form>
        </>
      ) : (
        <>
          <div className="label">
            오늘{" "}
            {view.sessionCount > 0
              ? `${view.sessionCount}번 근무 · 지금까지`
              : "아직 시작하지 않았습니다"}
          </div>
          <div className="figure">{hm(view.todayMinutes)}</div>
          <div className="note">
            {view.note ??
              (view.neededToday > 0
                ? `오늘 ${hm(view.neededToday)} 채우면 이번 정산기간 목표에 맞습니다.`
                : "오늘 채울 몫은 없습니다.")}
          </div>
          <form action={startWorkAction} style={{ marginTop: 16 }}>
            <button type="submit">
              {view.sessionCount > 0 ? "다시 근무 시작" : "근무 시작"}
            </button>
          </form>
          {view.sessionCount > 0 && (
            <p className="empty" style={{ marginTop: 10 }}>
              하루에 여러 번 나눠 일할 수 있습니다. 각 구간만 합산됩니다 —{" "}
              <Link href="/records">기록 보기</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
