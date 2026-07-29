import Link from "next/link";
import { DateTime } from "luxon";
import { loadOrgRules } from "@/db/access";
import { listMyTimeOff } from "@/db/timeoff";
import { TIME_OFF_LABEL as OFF_LABEL } from "@/lib/format";
import { now } from "@/lib/clock";
import { requestViewer } from "../viewer";
import { timeOffAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * 휴가.
 *
 * /records 에서 떼어낸 화면이다. 휴가는 근태 보정과 성격이 다르다 — 보정은
 * 실제로 일한 것을 신고하는 것이고, 휴가는 근로 의무를 면제받는 것이라
 * 소정근로가 줄어든다 (db/schema.ts 의 time_off 주석).
 *
 * 한 화면에 묶여 있었을 때 실제로 이랬다 — 신청 폼이 31일치 기록 카드 뒤
 * 9화면째(7557px)에 있었고, 메뉴 이름이 "내 기록 · 보정"이라 휴가를 찾으러
 * 갈 곳으로 읽히지 않았다. 처음 쓰는 사람은 기능이 있는 줄도 몰랐다.
 *
 * 정산기간에 묶지 않는다. 휴가는 다음 달 것을 이번 달에 신청하고, 승인 상태를
 * 나중에 확인한다 — 기간을 넘나드는 흐름이라 기간 이동 버튼이 방해가 된다.
 */
export default async function TimeOffPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  const { msg, err } = await searchParams;
  const viewer = await requestViewer("/time-off");
  const rules = await loadOrgRules(viewer.orgId);
  const zone = rules.attendance.timezone;
  const today = DateTime.fromJSDate(now(), { zone }).toISODate()!;

  const myOff = await listMyTimeOff(viewer);

  return (
    <main className="page">
      <div className="head">
        <h1>휴가</h1>
        <span className="team">{viewer.teamName ?? rules.orgName}</span>
      </div>
      <p className="sub">
        본인이 신청하고 팀장·HR이 승인합니다.
        <br />
        <span className="dim">
          승인된 것만 소정근로에서 빠집니다. 실제로 일한 날을 고치려면{" "}
          <Link href="/records">내 기록 · 보정</Link>으로 가세요.
        </span>
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
        승인 전에는 소정근로가 줄지 않는다 — 그렇지 않으면 본인이 자기 목표를
        낮출 수 있다. 잔여 연차는 관리하지 않으므로 그 사실을 밝힌다.
      */}
      <section className="card">
        <h2>휴가 신청</h2>
        <form action={timeOffAction} className="adjust">
          <input type="hidden" name="op" value="requestOff" />
          <label className="field">
            <span>날짜</span>
            <input type="date" name="offDate" required defaultValue={today} />
          </label>
          <label className="field">
            <span>종류</span>
            <select name="kind" defaultValue="full">
              <option value="full">연차</option>
              <option value="half_am">오전 반차</option>
              <option value="half_pm">오후 반차</option>
              <option value="unpaid">무급휴가</option>
            </select>
          </label>
          <label className="field grow">
            <span>
              사유<b> *</b>
            </span>
            <input
              type="text"
              name="offReason"
              required
              placeholder="개인 사정"
            />
          </label>
          <button type="submit">신청</button>
        </form>
        <p className="empty" style={{ marginTop: 10 }}>
          승인되면 소정근로에서 빠집니다. 승인 전에는 반영되지 않습니다.
          <br />
          남은 연차 일수는 이 앱에서 관리하지 않습니다 — 인사팀 기준을 따르세요.
        </p>
      </section>

      <section className="card">
        <h2>내 신청</h2>
        {myOff.length === 0 ? (
          <p className="empty">아직 신청한 휴가가 없습니다.</p>
        ) : (
          <ul className="offlist">
            {myOff.map((o) => (
              <li key={o.id}>
                <span className="d">
                  {DateTime.fromISO(o.date, { zone }).toFormat("M월 d일")}
                </span>
                <span className="k">{OFF_LABEL[o.kind]}</span>
                <span
                  className={
                    o.status === "approved"
                      ? "status good inline"
                      : o.status === "rejected"
                        ? "status crit inline"
                        : "status muted inline"
                  }
                >
                  <span className="dot" aria-hidden="true" />
                  {o.status === "approved"
                    ? `승인 · ${o.decidedByName}`
                    : o.status === "rejected"
                      ? "반려"
                      : "승인 대기"}
                </span>
                <span className="why">
                  {o.status === "rejected" && o.decisionNote
                    ? `반려 사유: ${o.decisionNote}`
                    : (o.reason ?? "")}
                </span>
                {/* 승인 후에는 본인이 취소할 수 없다 (팀장 결정) */}
                {o.status !== "approved" && (
                  <form action={timeOffAction}>
                    <input type="hidden" name="op" value="cancelOff" />
                    <input type="hidden" name="offId" value={o.id} />
                    <button type="submit" className="pill">
                      취소
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="empty" style={{ marginTop: 10 }}>
          반려된 날짜는 다시 신청할 수 있습니다. 승인된 휴가의 취소는 승인자가
          합니다.
        </p>
      </section>
    </main>
  );
}
