import Link from "next/link";
import { DateTime } from "luxon";
import { listUsers, loadOrgRules } from "@/db/access";
import { listHolidays, listTimeOff, ruleWarnings } from "@/db/settings";
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

export const dynamic = "force-dynamic";

const KIND_LABEL = {
  full: "연차",
  half_am: "오전 반차",
  half_pm: "오후 반차",
  unpaid: "무급",
} as const;

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
    breakRules: a.breakRules,
  });

  const holidayRows = await listHolidays(viewer.orgId);
  const people = await listUsers();

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
    a.breakRules.find((r) => r.overHours === 4)?.deductMinutes ?? 30;
  const break8 =
    a.breakRules.find((r) => r.overHours === 8)?.deductMinutes ?? 60;

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
          <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
            <button type="submit">저장하고 전원 재계산</button>
          </div>
        </form>
        <form action={recomputeAction} style={{ marginTop: 10 }}>
          <button type="submit" className="pill">
            규칙은 그대로, 재계산만
          </button>
        </form>
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
          <table style={{ marginTop: 14 }}>
            <tbody>
              {holidayRows.map((h) => (
                <tr key={h.id}>
                  <td>{h.date}</td>
                  <td>{h.name}</td>
                  <td>
                    <form action={removeHolidayAction}>
                      <input type="hidden" name="id" value={h.id} />
                      <button type="submit" className="pill">
                        삭제
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
          <table style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>날짜</th>
                <th>사람</th>
                <th>종류</th>
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
                  <td>{hours(t.deductMinutes)}시간</td>
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
        )}
      </section>
    </main>
  );
}
