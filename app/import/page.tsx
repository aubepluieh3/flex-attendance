import Link from "next/link";
import { loadOrgRules } from "@/db/access";
import { requestViewer } from "../viewer";
import { Importer } from "./importer";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const viewer = await requestViewer();
  const rules = await loadOrgRules(viewer.orgId);

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
        <Importer timezone={rules.attendance.timezone} />
      )}
    </main>
  );
}

const ROLE_LABEL = {
  member: "사원",
  manager: "팀장",
  hr: "HR",
  executive: "임원",
} as const;
