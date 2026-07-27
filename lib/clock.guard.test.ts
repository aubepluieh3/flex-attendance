import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * 기준 시각은 lib/clock.ts 의 now() 한 곳에서만 만든다.
 *
 * 같은 실수를 두 번 했다 (reopenPeriod, recomputeEveryone). 앱 안에 시계가
 * 두 개면 DEMO_CLOCK 과 테스트 기준 시각이 조용히 어긋나고, 마감 유예처럼
 * 시각에 의존하는 계산이 틀린다. 습관에 기대지 않고 여기서 막는다.
 *
 * 허용: new Date(인자) — 문자열·타임스탬프 파싱은 시계가 아니다.
 * 금지: new Date(), Date.now(), DateTime.now(), DateTime.local()
 */

const ROOTS = ["app", "db", "lib"];
const ALLOWLIST = new Set(["lib/clock.ts"]);

const FORBIDDEN = [
  { pattern: /new Date\(\s*\)/g, name: "new Date()" },
  { pattern: /Date\.now\(\s*\)/g, name: "Date.now()" },
  { pattern: /DateTime\.now\(\s*\)/g, name: "DateTime.now()" },
  { pattern: /DateTime\.local\(\s*\)/g, name: "DateTime.local()" },
];

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

describe("기준 시각은 lib/clock.ts 의 now() 만 쓴다", () => {
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
    // 테스트는 기준 시각을 직접 만들어야 하는 경우가 있다
    if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;

    // 주석에 규칙을 설명하는 문장이 있으므로 코드만 검사한다
    const source = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    for (const { pattern, name } of FORBIDDEN) {
      const hits = source.match(pattern);
      if (hits) offenders.push(`${rel}: ${name} ${hits.length}회`);
    }
  }

  it("금지된 시계 호출이 없다", () => {
    expect(offenders).toEqual([]);
  });
});
