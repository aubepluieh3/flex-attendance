"use client";

import { useActionState, useState } from "react";
import { DateTime } from "luxon";
import {
  mapRows,
  parseCsv,
  suggestMapping,
  type ColumnMapping,
  type Table,
} from "@/lib/csv";
import type { ImportReport } from "@/lib/import-types";
import { importAction, type ImportState } from "./actions";

const WEEKDAY = ["월", "화", "수", "목", "금", "토", "일"];
const PREVIEW_ROWS = 8;

type Mapping = Partial<ColumnMapping>;

export function Importer({ timezone }: { timezone: string }) {
  const [table, setTable] = useState<Table | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [split, setSplit] = useState(false);
  const [state, formAction, pending] = useActionState<ImportState, FormData>(
    importAction,
    { kind: "idle" },
  );

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setTable(null);
      return;
    }
    const parsed = parseCsv(await file.text());
    const suggestion = suggestMapping(parsed.headers);
    setTable(parsed);
    setMapping(suggestion);
    setSplit(Boolean(suggestion.date && suggestion.time));
  }

  const effective: Mapping = split
    ? { ...mapping, timestamp: undefined }
    : { ...mapping, date: undefined, time: undefined };

  const ready =
    Boolean(effective.employeeNo) &&
    (split
      ? Boolean(effective.date && effective.time)
      : Boolean(effective.timestamp));

  const result =
    table && ready
      ? mapRows(table, effective as ColumnMapping, timezone)
      : null;

  const pick = (key: keyof Mapping, label: string, required = false) => (
    <label className="field">
      <span>
        {label}
        {required && <b> *</b>}
      </span>
      <select
        value={mapping[key] ?? ""}
        onChange={(e) =>
          setMapping((m) => ({ ...m, [key]: e.target.value || undefined }))
        }
      >
        <option value="">선택 안 함</option>
        {table?.headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </label>
  );

  const showTime = (d: Date) => {
    const dt = DateTime.fromJSDate(d, { zone: timezone });
    return `${dt.toFormat("yyyy년 M월 d일")} (${WEEKDAY[dt.weekday - 1]}) ${dt.toFormat("HH:mm")}`;
  };

  return (
    <form action={formAction}>
      <section className="card">
        <h2>1. 파일 선택</h2>
        <input
          type="file"
          name="file"
          accept=".csv,.tsv,.txt"
          onChange={onPick}
        />
        {table && (
          <p className="sub" style={{ margin: "12px 0 0" }}>
            컬럼 {table.headers.length}개 · 데이터 {table.rows.length}행
          </p>
        )}
      </section>

      {table && (
        <section className="card">
          <h2>2. 컬럼 매핑</h2>
          <p className="empty" style={{ marginTop: -6 }}>
            헤더 이름으로 추측한 값입니다. 틀리면 직접 고르세요 — 잘못 매핑하면
            근태가 통째로 틀어집니다.
          </p>
          <div className="fields">
            {pick("employeeNo", "사번", true)}
            {split ? (
              <>
                {pick("date", "날짜", true)}
                {pick("time", "시각", true)}
              </>
            ) : (
              pick("timestamp", "일시", true)
            )}
            {pick("direction", "출입구분")}
            {pick("deviceLabel", "단말")}
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={split}
              onChange={(e) => setSplit(e.target.checked)}
            />
            날짜와 시각이 다른 컬럼에 있습니다
          </label>
        </section>
      )}

      {result && (
        <section className="card">
          <h2>3. 미리보기</h2>
          <div className="tiles" style={{ marginBottom: 14 }}>
            <div className="tile">
              <div className="k">전체</div>
              <div className="v">{table!.rows.length}행</div>
            </div>
            <div className="tile">
              <div className="k">읽힘</div>
              <div className="v">{result.tags.length}행</div>
            </div>
            <div className="tile">
              <div className="k">오류</div>
              <div className="v">{result.errors.length}행</div>
            </div>
          </div>

          {result.errors.length > 0 && (
            <ul className="issues" style={{ marginBottom: 14 }}>
              {result.errors.slice(0, 5).map((e) => (
                <li key={e.rowIndex}>
                  <span className="icon warn" aria-hidden="true">
                    !
                  </span>
                  <span>
                    <span className="what">{e.rowIndex}번째 줄</span>{" "}
                    <span className="why">{e.reason}</span>
                  </span>
                </li>
              ))}
              {result.errors.length > 5 && (
                <li>
                  <span className="why">
                    … 외 {result.errors.length - 5}건
                  </span>
                </li>
              )}
            </ul>
          )}

          {/* 원본 문자열과 해석 결과를 나란히 둔다 — 이게 없으면 검증이 불가능하다 */}
          <table>
            <thead>
              <tr>
                <th>사번</th>
                <th>파일에 적힌 값</th>
                <th>이렇게 읽었습니다</th>
                <th>구분</th>
                <th>단말</th>
              </tr>
            </thead>
            <tbody>
              {result.tags.slice(0, PREVIEW_ROWS).map((tag) => (
                <tr key={`${tag.rowIndex}`}>
                  <td>{tag.employeeNo}</td>
                  <td className="none">
                    {effective.timestamp
                      ? tag.raw[effective.timestamp]
                      : `${tag.raw[effective.date!]} ${tag.raw[effective.time!]}`}
                  </td>
                  <td>{showTime(tag.occurredAt)}</td>
                  <td>
                    {{ in: "입장", out: "퇴장", unknown: "—" }[tag.direction]}
                  </td>
                  <td>{tag.deviceLabel ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.tags.length > PREVIEW_ROWS && (
            <p className="empty" style={{ marginTop: 10 }}>
              앞 {PREVIEW_ROWS}행만 보여줍니다.
            </p>
          )}
        </section>
      )}

      <section className="card">
        <h2>4. 반영</h2>
        <input
          type="hidden"
          name="mapping"
          value={JSON.stringify(effective)}
        />
        <button type="submit" disabled={!ready || pending}>
          {pending ? "반영 중…" : "근태 기록에 반영"}
        </button>
        <p className="empty" style={{ marginTop: 10 }}>
          이미 있는 태그는 다시 넣지 않습니다. 같은 파일을 두 번 올려도
          안전합니다.
        </p>

        {state.kind === "error" && (
          <ul className="issues" style={{ marginTop: 14 }}>
            <li>
              <span className="icon crit" aria-hidden="true">
                !
              </span>
              <span className="what">{state.message}</span>
            </li>
          </ul>
        )}

        {state.kind === "done" && <Report report={state.report} />}
      </section>
    </form>
  );
}

function Report({ report }: { report: ImportReport }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div className="tiles">
        <div className="tile">
          <div className="k">새로 반영</div>
          <div className="v">{report.inserted}건</div>
        </div>
        <div className="tile">
          <div className="k">이미 있던 태그</div>
          <div className="v">{report.duplicates}건</div>
        </div>
        <div className="tile">
          <div className="k">오류</div>
          <div className="v">{report.errors.length}건</div>
        </div>
      </div>

      {report.unknownEmployees.length > 0 && (
        <ul className="issues" style={{ marginTop: 14 }}>
          {report.unknownEmployees.map((u) => (
            <li key={u.employeeNo}>
              <span className="icon warn" aria-hidden="true">
                !
              </span>
              <span>
                <span className="what">사번 {u.employeeNo}</span>{" "}
                <span className="why">
                  등록된 사용자가 없어 {u.rows}행을 넣지 않았습니다.
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {report.recomputed.length > 0 && (
        <table style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>사람</th>
              <th>기간</th>
              <th>일별 기록</th>
            </tr>
          </thead>
          <tbody>
            {report.recomputed.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>
                  {r.from} ~ {r.to}
                </td>
                <td>{r.days}일</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
