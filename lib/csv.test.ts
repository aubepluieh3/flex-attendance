import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  mapRows,
  parseCsv,
  parseDirection,
  parseTimestamp,
  suggestMapping,
} from "./csv";

const zone = "Asia/Seoul";

describe("parseCsv — 엑셀에서 나온 파일을 읽는다", () => {
  it("헤더와 행을 분리한다", () => {
    const t = parseCsv("사번,일시\nF001,2026-07-20 09:12\nF002,2026-07-20 09:30");
    expect(t.headers).toEqual(["사번", "일시"]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]).toEqual(["F001", "2026-07-20 09:12"]);
  });

  it("BOM과 CRLF를 처리한다", () => {
    const t = parseCsv("﻿사번,일시\r\nF001,2026-07-20 09:12\r\n");
    expect(t.headers).toEqual(["사번", "일시"]);
    expect(t.rows).toEqual([["F001", "2026-07-20 09:12"]]);
  });

  it("따옴표 안의 구분자를 필드로 쪼개지 않는다", () => {
    const t = parseCsv('사번,단말\nF001,"본사 3층, 정문"');
    expect(t.rows[0]).toEqual(["F001", "본사 3층, 정문"]);
  });

  it("이중따옴표 이스케이프를 읽는다", () => {
    const t = parseCsv('사번,비고\nF001,"저 ""게이트"" 앞"');
    expect(t.rows[0][1]).toBe('저 "게이트" 앞');
  });

  it("따옴표 안의 줄바꿈은 필드 내용이다", () => {
    const t = parseCsv('사번,비고\nF001,"1행\n2행"\nF002,정상');
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0][1]).toBe("1행\n2행");
    expect(t.rows[1][0]).toBe("F002");
  });

  it("탭 구분 파일도 읽는다", () => {
    const t = parseCsv("사번\t일시\nF001\t2026-07-20 09:12");
    expect(t.headers).toEqual(["사번", "일시"]);
    expect(t.rows[0]).toEqual(["F001", "2026-07-20 09:12"]);
  });

  it("빈 줄은 건너뛴다", () => {
    const t = parseCsv("사번,일시\n\nF001,2026-07-20 09:12\n\n");
    expect(t.rows).toHaveLength(1);
  });

  it("완전히 빈 파일은 빈 결과", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
    expect(parseCsv("\n\n")).toEqual({ headers: [], rows: [] });
  });
});

describe("suggestMapping — 컬럼 자동 감지 (제안까지만)", () => {
  it("한글 헤더를 잡는다", () => {
    const s = suggestMapping(["사번", "성명", "인증일시", "출입구분", "단말기"]);
    expect(s.employeeNo).toBe("사번");
    expect(s.timestamp).toBe("인증일시");
    expect(s.direction).toBe("출입구분");
    expect(s.deviceLabel).toBe("단말기");
  });

  it("영문 헤더도 잡는다", () => {
    const s = suggestMapping(["EmpNo", "Name", "Timestamp", "Direction", "Device"]);
    expect(s.employeeNo).toBe("EmpNo");
    expect(s.timestamp).toBe("Timestamp");
  });

  it("날짜와 시각이 나뉘어 있으면 둘 다 잡는다", () => {
    const s = suggestMapping(["사원번호", "날짜", "시각"]);
    expect(s.date).toBe("날짜");
    expect(s.time).toBe("시각");
    expect(s.timestamp).toBeUndefined();
  });

  it("일시 컬럼이 있으면 날짜+시각보다 우선한다", () => {
    const s = suggestMapping(["사번", "날짜", "시각", "발생일시"]);
    expect(s.timestamp).toBe("발생일시");
    expect(s.date).toBeUndefined();
  });

  it("못 찾으면 undefined — 추측해서 채우지 않는다", () => {
    const s = suggestMapping(["A", "B", "C"]);
    expect(s.employeeNo).toBeUndefined();
    expect(s.timestamp).toBeUndefined();
  });
});

describe("parseTimestamp — 현지 시각으로 읽는다", () => {
  const expectKst = (value: string, iso: string) => {
    const d = parseTimestamp(value, zone);
    expect(d).not.toBeNull();
    expect(DateTime.fromJSDate(d!, { zone }).toFormat("yyyy-MM-dd HH:mm")).toBe(
      iso,
    );
  };

  it("KST로 읽는다 — UTC로 읽으면 전 직원이 9시간 밀린다", () => {
    const d = parseTimestamp("2026-07-20 09:12", zone)!;
    expect(d.toISOString()).toBe("2026-07-20T00:12:00.000Z");
  });

  it("벤더별 형식들", () => {
    expectKst("2026-07-20 09:12:33", "2026-07-20 09:12");
    expectKst("2026-07-20 09:12", "2026-07-20 09:12");
    expectKst("2026/07/20 09:12:00", "2026-07-20 09:12");
    expectKst("2026.07.20 09:12:00", "2026-07-20 09:12");
    expectKst("20260720091233", "2026-07-20 09:12");
    expectKst("2026-07-20T09:12:00", "2026-07-20 09:12");
  });

  it("한 자리 시각도 읽는다 (엑셀이 0을 떼는 경우)", () => {
    expectKst("2026-07-20 9:12", "2026-07-20 09:12");
  });

  it("시각이 없으면 자정으로 읽는다", () => {
    expectKst("2026-07-20", "2026-07-20 00:00");
  });

  it("읽을 수 없으면 null — 임의로 채우지 않는다", () => {
    expect(parseTimestamp("어제", zone)).toBeNull();
    expect(parseTimestamp("", zone)).toBeNull();
    expect(parseTimestamp("2026-13-45 99:99", zone)).toBeNull();
  });
});

describe("parseDirection — 단말이 방향을 안 주는 경우가 많다", () => {
  it("입장/퇴장 계열", () => {
    expect(parseDirection("입장")).toBe("in");
    expect(parseDirection("출근")).toBe("in");
    expect(parseDirection("IN")).toBe("in");
    expect(parseDirection("퇴장")).toBe("out");
    expect(parseDirection("퇴근")).toBe("out");
    expect(parseDirection("Out")).toBe("out");
  });

  it("모르면 unknown — 첫·마지막 태그만 쓰므로 방향은 필수가 아니다", () => {
    expect(parseDirection(undefined)).toBe("unknown");
    expect(parseDirection("")).toBe("unknown");
    expect(parseDirection("인증성공")).toBe("unknown");
  });
});

describe("mapRows — 실패한 행을 조용히 버리지 않는다", () => {
  const table = parseCsv(
    [
      "사번,성명,인증일시,출입구분,단말기",
      "F2019-041,김도윤,2026-07-20 09:12:00,입장,본사 3층",
      "F2019-041,김도윤,2026-07-20 19:05:00,퇴장,본사 3층",
      ",무명,2026-07-20 10:00:00,입장,본사 3층",
      "F2016-008,이하람,날짜아님,입장,본사 3층",
    ].join("\n"),
  );
  const mapping = {
    employeeNo: "사번",
    timestamp: "인증일시",
    direction: "출입구분",
    deviceLabel: "단말기",
  };

  it("정상 행을 태그로 바꾼다", () => {
    const { tags } = mapRows(table, mapping, zone);
    expect(tags).toHaveLength(2);
    expect(tags[0].employeeNo).toBe("F2019-041");
    expect(tags[0].direction).toBe("in");
    expect(tags[0].deviceLabel).toBe("본사 3층");
    expect(tags[1].direction).toBe("out");
  });

  it("사번 없는 행과 일시가 깨진 행을 오류로 모은다", () => {
    const { errors } = mapRows(table, mapping, zone);
    expect(errors).toHaveLength(2);
    expect(errors[0].reason).toContain("사번");
    expect(errors[1].reason).toContain("일시");
  });

  it("오류 행 번호는 파일 줄 번호와 맞는다 (헤더 포함 1-based)", () => {
    const { errors } = mapRows(table, mapping, zone);
    expect(errors[0].rowIndex).toBe(4);
    expect(errors[1].rowIndex).toBe(5);
  });

  it("원본 행을 raw로 보관한다 — 매핑이 틀렸을 때 다시 읽으려면 필요하다", () => {
    const { tags } = mapRows(table, mapping, zone);
    expect(tags[0].raw["성명"]).toBe("김도윤");
    expect(Object.keys(tags[0].raw)).toEqual(table.headers);
  });

  it("날짜와 시각이 나뉘어 있어도 합쳐 읽는다", () => {
    const split = parseCsv(
      ["사원번호,날짜,시각", "F2019-041,2026-07-20,09:12:00"].join("\n"),
    );
    const { tags, errors } = mapRows(
      split,
      { employeeNo: "사원번호", date: "날짜", time: "시각" },
      zone,
    );
    expect(errors).toHaveLength(0);
    expect(
      DateTime.fromJSDate(tags[0].occurredAt, { zone }).toFormat("HH:mm"),
    ).toBe("09:12");
  });

  it("선택 컬럼이 없으면 기본값으로 둔다", () => {
    const minimal = parseCsv(["사번,일시", "F001,2026-07-20 09:12"].join("\n"));
    const { tags } = mapRows(
      minimal,
      { employeeNo: "사번", timestamp: "일시" },
      zone,
    );
    expect(tags[0].direction).toBe("unknown");
    expect(tags[0].deviceLabel).toBeNull();
  });
});
