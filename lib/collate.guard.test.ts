import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { byName, compareName, byIsoDate } from "./collate";

/**
 * 정렬 비교는 lib/collate.ts 를 거친다.
 *
 * `a.name.localeCompare(b.name)` 처럼 로케일 인자를 빼면 실행 환경의 기본
 * 로케일을 쓴다. 개발 머신(ko-KR)과 LANG 이 안 잡힌 컨테이너(en-US)에서 순서가
 * 달라지고, 서버 렌더링이라 보는 사람이 바로잡을 수도 없다. 네 곳에서 그러고
 * 있었다 — 같은 사람들을 담은 두 목록이 서로 다른 순서로 보일 수 있었다.
 *
 * 이건 기계가 판정할 수 있으니 검사로 막는다. 주석으로 적어두면 반복한다.
 *
 * 금지: localeCompare(x)  — 인자 하나
 * 허용: localeCompare(x, "ko") — 로케일을 박은 것. 다만 새로 쓸 이유가 없다
 */

const ROOTS = ["app", "db", "lib"];
const ALLOWLIST = new Set(["lib/collate.ts"]);

/** 인자가 하나뿐인 localeCompare. 중첩 괄호는 안 쓰이므로 이 정도로 충분하다 */
const BARE_LOCALE_COMPARE = /\.localeCompare\(\s*[^,)]*\)/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "migrations") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("정렬 비교는 lib/collate.ts 를 거친다", () => {
  const root = process.cwd();
  const files = ROOTS.flatMap((r) => {
    try {
      return walk(join(root, r));
    } catch {
      return [];
    }
  });

  it("스캔할 파일이 있다", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  const offenders: string[] = [];
  for (const file of files) {
    const rel = relative(root, file).replace(/\\/g, "/");
    if (ALLOWLIST.has(rel)) continue;
    if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;

    // 주석에 규칙을 설명하는 문장이 있으므로 코드만 검사한다
    const source = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    const hits = source.match(BARE_LOCALE_COMPARE);
    if (hits) offenders.push(`${rel}: ${hits.join(", ")}`);
  }

  it("로케일 없는 localeCompare 가 없다", () => {
    expect(offenders).toEqual([]);
  });
});

describe("이름 정렬", () => {
  it("한글과 영문이 섞여도 한글을 앞에 둔다 (ko 기준)", () => {
    // 로케일을 안 박으면 en 환경에서 Anderson·zoe 가 앞으로 온다
    const names = ["김도윤", "Anderson", "박준영", "zoe", "최민서"];
    expect([...names].sort(compareName)).toEqual([
      "김도윤",
      "박준영",
      "최민서",
      "Anderson",
      "zoe",
    ]);
  });

  it("숫자는 자릿수가 아니라 값으로 본다", () => {
    const teams = ["10팀", "2팀", "1팀"];
    expect([...teams].sort(compareName)).toEqual(["1팀", "2팀", "10팀"]);
  });

  it("byName 은 뽑아낸 값으로 비교한다", () => {
    const rows = [{ name: "최민서" }, { name: "김도윤" }];
    expect(rows.sort(byName((r) => r.name)).map((r) => r.name)).toEqual([
      "김도윤",
      "최민서",
    ]);
  });

  it("byIsoDate 는 날짜 문자열을 사전순으로 본다", () => {
    const days = [{ d: "2026-07-09" }, { d: "2026-07-10" }, { d: "2026-06-30" }];
    expect(days.sort(byIsoDate((x) => x.d)).map((x) => x.d)).toEqual([
      "2026-06-30",
      "2026-07-09",
      "2026-07-10",
    ]);
  });
});
