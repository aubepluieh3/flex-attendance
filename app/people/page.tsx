import Link from "next/link";
import { loadOrgRules } from "@/db/access";
import { listPeople, listTeams } from "@/db/people";
import { requestViewer } from "../viewer";
import { PeopleManager } from "./manager";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const viewer = await requestViewer();
  const rules = await loadOrgRules(viewer.orgId);

  if (viewer.role !== "hr") {
    return (
      <main className="page">
        <div className="head">
          <h1>사용자 관리</h1>
        </div>
        <section className="card">
          <ul className="issues">
            <li>
              <span className="icon crit" aria-hidden="true">!</span>
              <span>
                <span className="what">권한이 없습니다</span>
                <br />
                <span className="why">
                  사용자·팀 관리는 HR 권한이 필요합니다. 비밀번호를 바꾸려면{" "}
                  <Link href="/account">내 계정</Link>으로 가세요.
                </span>
              </span>
            </li>
          </ul>
        </section>
      </main>
    );
  }

  const [people, teams] = await Promise.all([
    listPeople(viewer),
    listTeams(viewer),
  ]);

  return (
    <main className="page">
      <div className="head">
        <h1>사용자 관리</h1>
        <span className="team">{rules.orgName}</span>
        <span className="chip">{viewer.name} · HR</span>
      </div>
      <p className="sub">
        입사자 추가, 비밀번호 초기화, 역할·팀 배정.
        <br />
        <span className="dim">
          비밀번호는 초기화만 가능합니다 — 저장된 값은 해시라서 HR 도 원본을 볼 수
          없습니다. 본인 변경은 각자 <Link href="/account">내 계정</Link>에서 합니다.
        </span>
      </p>
      <PeopleManager people={people} teams={teams} viewerId={viewer.id} />
    </main>
  );
}
