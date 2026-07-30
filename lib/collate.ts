/**
 * 이름 정렬은 여기 한 곳에서만 한다.
 *
 * 전에는 `a.name.localeCompare(b.name)` 를 로케일 인자 없이 네 곳에서 썼다.
 * 그러면 **실행 환경의 기본 로케일**을 쓴다 — 한글만 있을 때는 어디서나 같지만
 * 영문 이름이 한 명이라도 섞이면 갈린다:
 *
 *   ko  → 김도윤, 박준영, 최민서, Anderson, zoe
 *   en  → Anderson, zoe, 김도윤, 박준영, 최민서
 *
 * 개발 머신은 ko-KR 이고 LANG 이 안 잡힌 리눅스 컨테이너의 Node 는 en-US 로
 * 떨어진다. 같은 코드가 배포하면 다른 순서가 되고, 서버 렌더링이라 보는 사람이
 * 고칠 수도 없다. 게다가 같은 사람들을 담은 두 목록(구성원 목록과 확인 필요
 * 목록)이 서로 다른 순서로 보일 수 있다.
 *
 * 그래서 로케일을 박고, 비교기를 하나 만들어 재사용한다 (200명이면 비교가
 * 1500번 넘게 일어난다 — 그때마다 Collator 를 새로 만들지 않는다).
 */

/**
 * 사람·팀 이름 정렬용. 숫자는 자릿수가 아니라 값으로 본다
 * ("2팀"이 "10팀"보다 앞).
 */
const koCollator = new Intl.Collator("ko", { numeric: true, sensitivity: "variant" });

/** 이름 오름차순. `rows.sort(byName((r) => r.name))` 처럼 쓴다 */
export function byName<T>(pick: (row: T) => string) {
  return (a: T, b: T) => koCollator.compare(pick(a), pick(b));
}

/** 문자열 두 개를 바로 비교할 때 */
export const compareName = (a: string, b: string) => koCollator.compare(a, b);

/**
 * ISO 날짜(YYYY-MM-DD)·시각 문자열 정렬.
 *
 * 로케일과 무관하다 — 자릿수가 고정된 사전순 문자열이라 그냥 비교하면 된다.
 * 여기 두는 이유는 이름 정렬과 뜻을 갈라두려는 것이다. localeCompare 로
 * 날짜를 비교하면 "왜 로케일이 필요한가"를 읽는 사람이 다시 따져야 한다.
 */
export const byIsoDate = <T>(pick: (row: T) => string) => (a: T, b: T) => {
  const x = pick(a);
  const y = pick(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/** 문자열 두 개를 바로 비교할 때 */
export const compareIsoDate = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
