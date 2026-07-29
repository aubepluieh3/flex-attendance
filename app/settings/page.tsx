import Link from "next/link";
import { DateTime } from "luxon";
import { listUsers, loadOrgRules } from "@/db/access";
import { listHolidays, listTimeOff, ruleWarnings } from "@/db/settings";
import { listErrors } from "@/db/errors";
import { activeBatchCount } from "@/db/import-revoke";
import { resolvePeriod, shiftPeriod } from "@/lib/attendance/period";
import { now } from "@/lib/clock";
import { requestViewer } from "../viewer";
import {
  addHolidayAction,
  addTimeOffAction,
  recomputeAction,
  removeHolidayAction,
  removeTimeOffAction,
  saveRulesAction,
} from "./actions";
import { findTargetOverStatutory } from "@/lib/attendance/target-vs-statutory";
import { hm, TIME_OFF_LABEL as KIND_LABEL } from "@/lib/format";

export const dynamic = "force-dynamic";

const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  const { msg, err } = await searchParams;
  const viewer = await requestViewer("/settings");
  const rules = await loadOrgRules(viewer.orgId);
  const zone = rules.attendance.timezone;

  if (viewer.role !== "hr") {
    return (
      <main className="page">
        <div className="head">
          <h1>근태 설정</h1>
        </div>
        <section className="card">
          <ul className="issues">
            <li>
              <span className="icon crit" aria-hidden="true">
                !
              </span>
              <span>
                <span className="what">권한이 없습니다</span>
                <br />
                <span className="why">
                  근태 규칙 변경은 HR 권한이 필요합니다. 전 직원의 집계가
                  다시 계산됩니다.
                </span>
              </span>
            </li>
          </ul>
          <p className="empty" style={{ marginTop: 12 }}>
            <Link href="/">내 근무시간으로 돌아가기</Link>
          </p>
        </section>
      </main>
    );
  }

  const a = rules.attendance;
  const warnings = ruleWarnings({
    coreTime: a.coreTime,
    flexBand: a.flexBand,
    dailyLimitMinutes: a.dailyLimitMinutes,
    autoBreakRules: a.autoBreakRules,
  });

  /*
   * 소정근로가 법정근로 총량을 넘는 기간 — business_days 방식일 때만 생긴다.
   * fixed 는 기간당 고정 시간이라 영업일 수와 무관하다.
   * 값을 고치지 않고 성질만 알려준다 (target-vs-statutory.ts 상단 참조).
   */
  const overStatutory =
    rules.settlement.targetCalcMethod === "business_days"
      ? findTargetOverStatutory({
          kind: rules.settlementKind,
          weekStartDay: rules.weekStartDay,
          timezone: zone,
          weekendDays: rules.settlement.weekendDays,
          holidays: rules.settlement.holidays,
          standardMinutesPerDay: rules.settlement.standardMinutesPerDay,
          legalWeeklyMinutes: rules.settlement.legalWeeklyMinutes,
          from: now(),
        })
      : [];

  const holidayRows = await listHolidays(viewer.orgId);
  const people = await listUsers();
  const errors = await listErrors(viewer);
  /** 아직 근태 파일을 한 번도 안 올렸으면 처음 설정 중으로 본다 */
  const neverImported = (await activeBatchCount(viewer.orgId)) === 0;

  const opts = {
    kind: rules.settlementKind,
    weekStartDay: rules.weekStartDay,
    timezone: zone,
  };
  const thisPeriod = resolvePeriod(
    DateTime.fromJSDate(now(), { zone }).toISODate()!,
    opts,
  );
  const offFrom = shiftPeriod(thisPeriod, -4, opts).start;
  const offTo = shiftPeriod(thisPeriod, 4, opts).end;
  const timeOffRows = await listTimeOff(viewer.orgId, offFrom, offTo);

  const break4 =
    a.autoBreakRules.find((r) => r.overHours === 4)?.deductMinutes ?? 30;
  const break8 =
    a.autoBreakRules.find((r) => r.overHours === 8)?.deductMinutes ?? 60;

  return (
    <main className="page">
      <div className="head">
        <h1>근태 설정</h1>
        <span className="team">{rules.orgName}</span>
        <span className="chip">{viewer.name} · HR</span>
      </div>
      <p className="sub">
        선택적 근로시간제 (근로기준법 §52) 기준 설정입니다.
        <br />
        <span className="dim">
          규칙을 저장하면 전 직원의 일별 집계가 원본 태그에서 다시 계산됩니다.
          마감된 기간의 공식 기록은 스냅샷이라 바뀌지 않고 &quot;마감 후
          변경&quot;으로 표시됩니다.
        </span>
      </p>

      {(msg || err) && (
        <section className="card">
          <ul className="issues">
            <li>
              <span className={`icon ${err ? "crit" : "warn"}`} aria-hidden="true">
                !
              </span>
              <span className="what">{err ?? msg}</span>
            </li>
          </ul>
        </section>
      )}

      {/*
        처음 설정 순서.
        순서를 틀려도 기술적으로는 복구되지만(파생 데이터라 재계산하면 된다),
        문제는 HR 이 잘못된 숫자를 한 번 믿고 팀장에게 보고한 뒤에 바뀌는 것이다.
        정산기간을 주↔월로 늦게 바꾸면 이미 찍힌 스냅샷과 기간 경계가 어긋난다.
        db:bootstrap 도 이 순서를 출력하지만, 그걸 본 사람과 나중에 시스템을
        물려받는 사람이 다르다.

        아직 CSV 를 한 번도 안 올렸으면 펼쳐 두고, 그 뒤로는 접는다 —
        항상 띄우면 소음이 된다.
      */}
      <details className="fold" open={neverImported} style={{ marginBottom: 14 }}>
        <summary>처음 설정 순서</summary>
        <div className="scroll-x">
          <ol className="steps">
            <li>
              <b>여기(근태 규칙)를 먼저 맞춥니다.</b> 정산기간·의무근로시간대·
              휴게·1일 상한은 <b>서면합의 사항</b>입니다. 지금 값은 예시일 뿐이니
              그대로 쓰면 안 됩니다.
            </li>
            <li>
              <b>공휴일</b>을 넣습니다. 소정근로 계산에서 빠집니다.
            </li>
            <li>
              <b>사용자 관리</b>에서 구성원을 추가하고 팀을 배정합니다. 사번은
              CSV 의 사번과 정확히 같아야 매칭됩니다.
            </li>
            <li>
              <b>그다음에</b> 근태 파일을 올립니다.
            </li>
          </ol>
          <p className="empty" style={{ marginTop: 10 }}>
            순서를 바꿔도 되돌릴 수는 있습니다 — 규칙을 고치면 전 직원 집계가 다시
            계산됩니다. 다만 <b>한 번 본 숫자가 나중에 전부 바뀝니다.</b> 그 숫자로
            팀장에게 보고했다면 다시 설명해야 합니다.
            <br />
            정산기간(주↔월)은 특히 늦게 바꾸지 마세요. 이미 마감된 기간의 공식
            기록은 그 기간 기준으로 얼어 있어서 경계가 어긋납니다.
          </p>
        </div>
      </details>

      {warnings.length > 0 && (
        <section className="card">
          <h2>설정 점검</h2>
          <ul className="issues">
            {warnings.map((w) => (
              <li key={w}>
                <span className="icon warn" aria-hidden="true">
                  !
                </span>
                <span className="why">{w}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>근태 규칙</h2>
        <form action={saveRulesAction}>
          <div className="fields">
            <label className="field">
              <span>정산기간</span>
              <select name="settlementPeriod" defaultValue={rules.settlementKind}>
                <option value="week">주</option>
                <option value="month">월</option>
              </select>
            </label>
            <label className="field">
              <span>주 시작일</span>
              <select name="weekStartDay" defaultValue={rules.weekStartDay}>
                {["월", "화", "수", "목", "금", "토", "일"].map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d}요일
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>소정근로 산정</span>
              <select
                name="targetCalcMethod"
                defaultValue={rules.settlement.targetCalcMethod}
              >
                <option value="business_days">영업일 × 1일 소정근로</option>
                <option value="fixed">기간당 고정</option>
              </select>
            </label>
            <label className="field">
              <span>고정 목표(시간)</span>
              <input
                type="number"
                name="targetHours"
                step="0.5"
                defaultValue={hours(rules.settlement.fixedTargetMinutes)}
              />
            </label>
            <label className="field">
              <span>1일 소정근로(시간)</span>
              <input
                type="number"
                name="standardHours"
                step="0.5"
                defaultValue={hours(rules.settlement.standardMinutesPerDay)}
              />
            </label>
            <label className="field">
              <span>주 평균 상한(시간)</span>
              <input
                type="number"
                name="limitHours"
                step="1"
                defaultValue={hours(rules.settlement.maxAvgWeeklyMinutes)}
              />
            </label>
            {/*
              소정근로와 법정 총량은 기준이 다르다 —
                소정근로  = 영업일 × 1일 소정근로
                법정 총량 = 역일 ÷ 7 × 40시간 (§50)
              그래서 영업일이 많은 달에는 소정근로를 정확히 채우기만 해도
              연장근로가 발생한다. 앱은 소정근로를 깎지 않는다(§2①7호로 당사자가
              정하는 값이다). 대신 이 성질을 상시 보여준다.
            */}
            {overStatutory.length > 0 && (
              <p className="empty" style={{ gridColumn: "1 / -1", margin: 0 }}>
                <b>
                  현재 산정 방식에서는 월별 영업일 수에 따라 소정근로시간이
                  법정근로 총량을 초과할 수 있습니다.
                </b>
                <br />
                앞으로 1년 중 {overStatutory.length}개 기간이 여기 걸립니다 —{" "}
                {overStatutory
                  .slice(0, 4)
                  .map(
                    (m) =>
                      `${m.label}: 소정근로 ${hm(m.targetMinutes)} / 법정근로 총량 약 ${hm(m.statutoryMinutes)} (+${hm(m.overMinutes)})`,
                  )
                  .join(" · ")}
                {overStatutory.length > 4 && ` 외 ${overStatutory.length - 4}개`}
                <br />
                초과분은 연장근로이며 가산수당 대상입니다(§56). 앱은 소정근로를
                법정 총량으로 자동 보정하지 않습니다.
              </p>
            )}
            <label className="field">
              <span>날짜 귀속 기준시각</span>
              <input
                type="number"
                name="dayBoundaryHour"
                min={0}
                max={12}
                defaultValue={a.dayBoundaryHour}
              />
            </label>
            <label className="field">
              <span>1일 상한(시간)</span>
              <input
                type="number"
                name="dailyLimitHours"
                step="0.5"
                defaultValue={
                  a.dailyLimitMinutes === null ? "" : hours(a.dailyLimitMinutes)
                }
                placeholder="비우면 미적용"
              />
            </label>
            <label className="field">
              <span>휴게: 4시간↑ (분)</span>
              <input type="number" name="break4h" defaultValue={break4} />
            </label>
            <label className="field">
              <span>휴게: 8시간↑ (분)</span>
              <input type="number" name="break8h" defaultValue={break8} />
            </label>
            <label className="field">
              <span>의무근로 시작</span>
              <input
                type="time"
                name="coreTimeStart"
                defaultValue={a.coreTime?.start ?? ""}
              />
            </label>
            <label className="field">
              <span>의무근로 종료</span>
              <input
                type="time"
                name="coreTimeEnd"
                defaultValue={a.coreTime?.end ?? ""}
              />
            </label>
            <label className="field">
              <span>선택시간대 시작</span>
              <input
                type="time"
                name="flexBandStart"
                defaultValue={a.flexBand?.start ?? ""}
              />
            </label>
            <label className="field">
              <span>선택시간대 종료</span>
              <input
                type="time"
                name="flexBandEnd"
                defaultValue={a.flexBand?.end ?? ""}
              />
            </label>
            <label className="field">
              <span>야간 시작</span>
              <input
                type="time"
                name="nightWindowStart"
                defaultValue={a.nightWindow.start}
              />
            </label>
            <label className="field">
              <span>야간 종료</span>
              <input
                type="time"
                name="nightWindowEnd"
                defaultValue={a.nightWindow.end}
              />
            </label>
            <label className="field">
              <span>마감 유예(일)</span>
              <input
                type="number"
                name="closeGraceDays"
                min={0}
                defaultValue={rules.closeGraceDays}
              />
            </label>
            <label className="field">
              <span>보정 검토 기준(시간)</span>
              <input
                type="number"
                name="reviewThresholdHours"
                step="0.5"
                defaultValue={hours(rules.reviewThresholdMinutes)}
              />
            </label>
          </div>
          {/*
            규칙을 바꾸면 전 직원의 과거 집계가 다시 계산된다.
            한 번의 클릭으로 실행되면 안 된다 — 처음 쓰는 사용자로 걸어보니
            아무 생각 없이 눌러서 전원 재계산이 즉시 돌았다.
          */}
          <details className="confirm" style={{ marginTop: 16 }}>
            <summary>저장하고 전원 재계산…</summary>
            <div className="box">
              <span className="why">
                구성원 {people.length}명의 과거 집계가 새 규칙으로 다시
                계산됩니다. 마감된 기간의 공식 기록(스냅샷)은 바뀌지 않고
                &quot;마감 후 변경&quot;으로 표시됩니다.
              </span>
              <button type="submit" className="danger">
                네, 저장하고 재계산합니다
              </button>
            </div>
          </details>
        </form>
        <details className="confirm" style={{ marginTop: 10 }}>
          <summary>규칙은 그대로, 재계산만…</summary>
          <div className="box">
            <span className="why">
              설정을 바꾸지 않고 원본 태그에서 다시 계산합니다. 늦게 들어온
              기록을 반영할 때 씁니다.
            </span>
            <form action={recomputeAction} className="inline">
              <button type="submit" className="danger">
                네, 재계산합니다
              </button>
            </form>
          </div>
        </details>
      </section>

      <section className="card">
        <h2>공휴일</h2>
        <form action={addHolidayAction} className="adjust">
          <label className="field">
            <span>날짜</span>
            <input type="date" name="date" required />
          </label>
          <label className="field grow">
            <span>이름</span>
            <input type="text" name="name" required placeholder="삼일절 대체공휴일" />
          </label>
          <button type="submit">추가</button>
        </form>

        {holidayRows.length === 0 ? (
          <p className="empty" style={{ marginTop: 14 }}>
            등록된 공휴일이 없습니다. 공휴일은 소정근로에서 빠집니다.
          </p>
        ) : (
          <div className="scroll-x" style={{ marginTop: 14 }}>
          <table>
            <tbody>
              {holidayRows.map((h) => (
                <tr key={h.id}>
                  <td>{h.date}</td>
                  <td>{h.name}</td>
                  <td>
                    {/* 지우면 그 날이 영업일이 되어 전 직원 소정근로가 늘어난다 */}
                    <details className="confirm">
                      <summary>삭제…</summary>
                      <div className="box">
                        <span className="why">
                          {h.date} 이 다시 영업일이 되어 전 직원 소정근로가
                          늘어납니다.
                        </span>
                        <form action={removeHolidayAction} className="inline">
                          <input type="hidden" name="id" value={h.id} />
                          <button type="submit" className="danger">
                            네, 삭제합니다
                          </button>
                        </form>
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>휴가</h2>
        <form action={addTimeOffAction} className="adjust">
          <label className="field">
            <span>사번</span>
            <select name="employeeNo" required>
              {people.map((p) => (
                <option key={p.id} value={p.employeeNo}>
                  {p.name} ({p.employeeNo})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>날짜</span>
            <input type="date" name="date" required />
          </label>
          <label className="field">
            <span>종류</span>
            <select name="kind" defaultValue="full">
              {Object.entries(KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow">
            <span>사유</span>
            <input type="text" name="reason" placeholder="(선택)" />
          </label>
          <button type="submit">등록</button>
        </form>

        {timeOffRows.length === 0 ? (
          <p className="empty" style={{ marginTop: 14 }}>
            {offFrom} ~ {offTo} 사이에 등록된 휴가가 없습니다.
          </p>
        ) : (
          <div className="scroll-x" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>날짜</th>
                <th>사람</th>
                <th>종류</th>
                <th>상태</th>
                <th>차감</th>
                <th>사유</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {timeOffRows.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>{t.userName}</td>
                  <td>{KIND_LABEL[t.kind]}</td>
                  {/*
                    승인 대기·반려는 소정근로에 반영되지 않는다. 상태를 안 보이면
                    HR 이 "등록했는데 왜 집계가 안 바뀌나" 를 알 수 없다.
                  */}
                  <td>
                    {t.status === "approved" ? (
                      "승인"
                    ) : (
                      <span className="tag">
                        {t.status === "pending" ? "승인 대기" : "반려"}
                      </span>
                    )}
                  </td>
                  <td>
                    {t.status === "approved" ? (
                      `${hours(t.deductMinutes)}시간`
                    ) : (
                      <span className="none">—</span>
                    )}
                  </td>
                  <td className="none">{t.reason ?? "—"}</td>
                  <td>
                    <form action={removeTimeOffAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <button type="submit" className="pill">
                        삭제
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>

      {/*
        오류 기록.
        지금까지는 오류가 사용자 화면에 배너로만 뜨고 아무 데도 안 남았다.
        500 이 떠도 사용자가 말해주기 전까지 몰랐다.
        외부 모니터링을 쓰지 않는 이유는 근태 데이터를 밖으로 보내지 않기 위해서다.
      */}
      <section className="card">
        <h2>
          오류 기록
          {errors.length > 0 && (
            <span className="tag">최근 {errors.length}건</span>
          )}
        </h2>
        {errors.length === 0 ? (
          <p className="empty">기록된 오류가 없습니다.</p>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>시각</th>
                  <th>위치</th>
                  <th>사람</th>
                  <th>메시지</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e) => (
                  <tr key={e.id}>
                    <td>
                      {DateTime.fromJSDate(e.createdAt, { zone }).toFormat(
                        "M/d HH:mm",
                      )}
                    </td>
                    <td className="none">{e.where}</td>
                    <td className="none">{e.userName ?? "—"}</td>
                    <td style={{ textAlign: "left", whiteSpace: "normal" }}>
                      {e.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="empty" style={{ marginTop: 10 }}>
          30일 지난 기록은 지워집니다. 스택트레이스는 저장하지 않습니다 — 사번·
          이름이 섞여 들어갈 수 있기 때문입니다.
        </p>
      </section>
    </main>
  );
}
