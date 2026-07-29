import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 화면 규칙을 기계가 강제한다.
 *
 * 이 파일이 있는 이유: 같은 실수를 문장으로 적어두면 반복했다. 시계 규칙만
 * 안 반복됐는데, 그건 lib/clock.guard.test.ts 가 잡아주기 때문이다.
 * 문장은 기억해야 발동하고 테스트는 잊어도 발동한다.
 *
 * 여기 넣는 규칙의 조건: 기계가 판정할 수 있어야 한다. "자기신고에 불이익을
 * 붙이지 마라" 같은 건 판정할 수 없어서 코드 옆 주석으로 둔다.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.ts$/.test(p)) out.push(p);
  }
  return out;
}

const files = walk("app").map((path) => ({
  path: path.replace(/\\/g, "/"),
  src: readFileSync(path, "utf8"),
}));

/** 줄 단위로 훑되, 앞뒤 문맥을 함께 본다 */
const findLines = (
  src: string,
  test: (line: string, i: number, lines: string[]) => boolean,
) => {
  const lines = src.split("\n");
  return lines
    .map((l, i) => (test(l, i, lines) ? i + 1 : 0))
    .filter((n) => n > 0);
};

describe("표는 가로 스크롤 컨테이너 안에 둔다", () => {
  /*
   * 셀이 nowrap 이라 열이 많으면 표의 최소 너비가 화면보다 커진다. 감싸지 않으면
   * 페이지 전체가 좌우로 밀린다. 320px 에서 실제로 27px 밀렸고, 그때
   * <table> 만 찾아 고쳐서 <table style={{...}}> 세 개를 놓쳤다.
   */
  it("모든 <table> 위에 .scroll-x 가 있다", () => {
    const bad: string[] = [];
    for (const { path, src } of files) {
      const hits = findLines(src, (l, i, lines) => {
        if (!/<table[\s>]/.test(l)) return false;
        // 바로 위 3줄 안에 scroll-x 래퍼가 있어야 한다
        return !lines
          .slice(Math.max(0, i - 3), i)
          .some((prev) => prev.includes('className="scroll-x"'));
      });
      for (const n of hits) bad.push(`${path}:${n}`);
    }
    expect(bad, "표를 .scroll-x 로 감싸세요").toEqual([]);
  });
});

describe("되돌리기 어려운 행동은 한 번의 클릭으로 실행되지 않는다", () => {
  /*
   * 색(danger)만으로는 부족했다. 처음 쓰는 사용자로 걸어보니 비활성화·전원
   * 재계산이 한 번의 클릭으로 실행됐고, 실수로 사람을 쫓아냈다.
   *
   * 막는 방법은 둘 다 인정한다 — 둘 다 "그냥 눌러서는 안 되는" 상태를 만든다.
   *   details.confirm 게이트  → 두 번 눌러야 한다
   *   required 입력          → 뭔가 적어야 한다 (재마감 사유처럼)
   * 둘을 겹치면 3단계가 되어 과하다.
   */
  it('className="danger" 버튼은 게이트나 필수 입력 뒤에 있다', () => {
    const bad: string[] = [];
    for (const { path, src } of files) {
      // 오류 화면의 복구 버튼은 대상이 아니다
      if (path.includes("global-error")) continue;
      const hits = findLines(src, (l, i, lines) => {
        if (!/className=(\{[^}]*"danger"|"danger")/.test(l)) return false;
        const above = lines.slice(Math.max(0, i - 30), i);
        const gated = above.some((p) => p.includes('className="confirm"'));
        const needsInput = above.some((p) => /\brequired\b/.test(p));
        return !gated && !needsInput;
      });
      for (const n of hits) bad.push(`${path}:${n}`);
    }
    expect(
      bad,
      "danger 버튼을 details.confirm 안에 두거나 required 입력을 요구하세요",
    ).toEqual([]);
  });
});

describe("서버 액션은 오류를 기록한다", () => {
  /*
   * 오류가 배너로만 뜨고 아무 데도 안 남으면, 500 이 떠도 사용자가 말해주기
   * 전까지 모른다. rethrowControlFlow 만 부르고 기록을 빼먹기 쉬웠다.
   */
  it("catch 에서 reportActionError 를 부른다", () => {
    const bad: string[] = [];
    for (const { path, src } of files) {
      if (!/^app\/.*actions?\.ts$/.test(path) && !path.endsWith("actions.ts")) {
        continue;
      }
      if (!src.includes("catch")) continue;
      if (src.includes("reportActionError")) continue;
      bad.push(path);
    }
    expect(bad, "액션 catch 에서 reportActionError 를 부르세요").toEqual([]);
  });
});

describe("예상 한도 초과는 본인 화면에만 둔다", () => {
  /*
   * 확정 초과(exceedsAvgWeeklyLimit)는 "남은 날을 전부 쉬어도 되돌릴 수 없다"는
   * 뜻이라 관리자도 알아야 한다. 예상(willExceedAvgWeeklyLimit)은 다르다 —
   * 팀장·HR 화면에 예상 위법이 뜨면 지목된 사람이 줄이는 게 근무가 아니라
   * 기록일 수 있다. 자기신고에 불이익을 붙이는 설계와 같은 종류다.
   *
   * 문장으로 적어두면 다음에 "팀장도 미리 알면 좋지 않나"로 새기 쉬워서
   * 검사로 옮긴다. 뒤집을 일이 생기면 이 테스트를 지우는 게 그 결정이다.
   */
  const MANAGER_FACING = [
    "app/team/page.tsx",
    "app/team/[userId]/page.tsx",
    "app/report/page.tsx",
    "db/team.ts",
    "db/report.ts",
  ];
  const PROJECTION = ["willExceedAvgWeeklyLimit", "projectedAvgWeeklyMinutes"];

  /** 규칙을 설명하는 주석에도 필드 이름이 나오므로 코드만 본다 (clock guard 와 같은 방식) */
  const codeOf = (path: string) =>
    readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("관리자 화면은 예상값을 읽지 않는다", () => {
    const bad: string[] = [];
    for (const path of MANAGER_FACING) {
      const src = codeOf(path);
      for (const field of PROJECTION) {
        if (src.includes(field)) bad.push(`${path}: ${field}`);
      }
    }
    expect(bad, "예상 한도 초과는 본인 화면(app/page.tsx)에만 둡니다").toEqual(
      [],
    );
  });

  it("본인 화면은 예상값을 읽는다", () => {
    // 위 검사만 두면 필드를 아무 데서도 안 쓰는 상태로도 통과한다
    const src = codeOf("app/page.tsx");
    for (const field of PROJECTION) {
      expect(src, `app/page.tsx 가 ${field} 를 쓰지 않는다`).toContain(field);
    }
  });
});

describe("알림 종류를 늘리면 화면 표시도 늘린다", () => {
  /*
   * 휴가 알림 두 종류를 넣을 때 KIND_TONE 을 빠뜨렸다. 빠뜨리면 색이
   * 기본값으로 떨어져서 위법 소지가 경고처럼 보이지 않는다.
   */
  it("Draft.kind 의 모든 값이 KIND_TONE 에 있다", () => {
    const notify = readFileSync("db/notify.ts", "utf8");
    const page = readFileSync("app/notifications/page.tsx", "utf8");

    const block = notify.slice(
      notify.indexOf("type Draft = {"),
      notify.indexOf("dedupeKey: string"),
    );
    const kinds = [...block.matchAll(/\|\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(kinds.length, "Draft.kind 를 못 읽었다").toBeGreaterThan(3);

    const missing = kinds.filter((k) => !page.includes(`${k}:`));
    expect(missing, "app/notifications/page.tsx 의 KIND_TONE 에 추가하세요").toEqual(
      [],
    );
  });
});
