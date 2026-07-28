import Link from "next/link";
import { loadOrgRules } from "@/db/access";
import { fmtWhen, listBatches } from "@/db/import-revoke";
import { ROLE_LABEL } from "@/lib/format";
import { requestViewer } from "../viewer";
import { Importer } from "./importer";
import { revokeBatchAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  const { msg, err } = await searchParams;
  const viewer = await requestViewer("/import");
  const rules = await loadOrgRules(viewer.orgId);
  const batches = viewer.role === "hr" ? await listBatches(viewer) : [];

  return (
    <main className="page">
      <div className="head">
        <h1>근태 파일 반영</h1>
        <span className="team">{rules.orgName}</span>
        <span className="chip">
          {viewer.name} · {ROLE_LABEL[viewer.role]}
        </span>
      </div>
      <p className="sub">
        사원증·지문 단말에서 내보낸 CSV를 올립니다.
        <br />
        <span className="dim">
          벤더 포맷을 모르므로 컬럼은 파일마다 지정합니다. 시각은{" "}
          {rules.attendance.timezone} 기준으로 읽습니다.
        </span>
      </p>

      {viewer.role !== "hr" ? (
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
                  근태 파일 반영은 HR 권한이 필요합니다. 전 직원의 근태가
                  바뀌는 작업입니다.
                </span>
              </span>
            </li>
          </ul>
          <p className="empty" style={{ marginTop: 12 }}>
            <Link href="/">내 근무시간으로 돌아가기</Link>
          </p>
        </section>
      ) : (
        <>
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

          <Importer timezone={rules.attendance.timezone} />

          {/*
            무효화가 없으면 HR 이 임포트를 두려워하고, 그러면 근태가 안 들어온다.
            잘못 올린 파일은 "있었던 사실"이 아니라 실수다.
          */}
          <section className="card">
            <h2>최근 반영 이력</h2>
            {batches.length === 0 ? (
              <p className="empty">아직 반영한 파일이 없습니다.</p>
            ) : (
              <ul className="offlist">
                {batches.map((b) => (
                  <li key={b.id}>
                    <span className="d">
                      {fmtWhen(b.createdAt, rules.attendance.timezone)}
                    </span>
                    <span className="k">{b.fileName}</span>
                    <span className="why">
                      {b.revokedAt
                        ? `무효화됨 · ${b.revokedByName}`
                        : `${b.insertedCount}건 반영 · ${b.skippedCount}건 중복 제외 · ${b.uploadedByName}`}
                    </span>
                    {!b.revokedAt && b.liveTags > 0 && (
                      <details className="confirm">
                        <summary>무효화…</summary>
                        <div className="box">
                          <span className="why">
                            이 파일로 들어온 태그 {b.liveTags}건을 지우고 해당
                            인원의 집계를 다시 계산합니다. 되돌릴 수 없습니다 —
                            필요하면 파일을 다시 올려야 합니다.
                          </span>
                          <form action={revokeBatchAction} className="inline">
                            <input type="hidden" name="batchId" value={b.id} />
                            <button type="submit" className="danger">
                              네, 무효화합니다
                            </button>
                          </form>
                        </div>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="empty" style={{ marginTop: 10 }}>
              무효화하면 그 파일로 들어온 태그를 지우고 해당 인원의 집계를 다시
              계산합니다. 마감된 기간이 걸린 파일은 무효화할 수 없습니다.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
