import type { Metadata } from "next";
import Link from "next/link";
import "./intro.css";

/*
 * 소개 페이지 — 사용자에게 무엇이 되는지 보여준다.
 *
 * 기술 스택·구조는 README 에 있고 여기서는 말하지 않는다. 읽는 사람은
 * "9시에 안 와도 되는 회사에 다니게 된 직원"이다. 궁금한 건 하나다 —
 * 내가 얼마나 더 일해야 하고, 그걸 누가 어떻게 세는가.
 *
 * 로그인 없이 열린다. 레이아웃이 viewer 없을 때 사이드바를 안 두므로
 * 이 파일이 화면 전체를 쓴다. 화면 목업은 그림이 아니라 실제 화면의 CSS
 * 재현이다 — 앱을 고치면 이 페이지가 조금씩 낡는다는 뜻이고, 그래서
 * 숫자는 데모 시나리오 하나(7월 정산기간, 김도윤)로 고정해 둔다.
 */

export const metadata: Metadata = {
  title: "flex-attendance — 출근 시각을 정하지 않습니다",
  description:
    "정산기간 안에 총 근무시간만 맞추는 자율 출근제 근태 관리. 남은 시간, 나눠 일한 날, 주 52시간을 한 화면에서 봅니다.",
};

/** 내 근무시간 — 남은 시간이 주인공이다 */
function ShotDashboard() {
  return (
    <div className="shot">
      <div className="bar">
        <i />
        <i />
        <i />
        <span>내 근무시간</span>
      </div>
      <div className="pane">
        <div className="who-row">
          <b>김도윤</b>
          <span>7월 1일 – 7월 31일 · 3일 남음</span>
        </div>

        <div className="fig">
          57<small>시간</small> 20<small>분</small>
        </div>
        <div className="cap">남은 시간 · 이 정산기간에 더 일해야 하는 몫</div>

        <div className="prog">
          <i style={{ width: "67%" }} />
          <u style={{ left: "71%" }} />
        </div>
        <div className="legend">
          <span>67% 채웠습니다</span>
          <span>기대선 71%</span>
        </div>

        <div className="tiles">
          <div className="box">
            <div className="k">누적</div>
            <div className="v">118h 40m</div>
          </div>
          <div className="box">
            <div className="k">소정근로</div>
            <div className="v">176h 00m</div>
          </div>
          <div className="box">
            <div className="k">이 페이스면</div>
            <div className="v">172h 10m</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 오늘 카드 — 버튼 하나와 그 옆의 한 문장 */
function ShotToday() {
  return (
    <div className="shot">
      <div className="bar">
        <i />
        <i />
        <i />
        <span>오늘</span>
      </div>
      <div className="pane">
        <div className="who-row">
          <b>근무 중</b>
          <span>09:28 시작 · 사원증</span>
        </div>

        <div className="fig">
          3<small>시간</small> 12<small>분</small>
        </div>
        <div className="cap">오늘 지금까지</div>

        <div className="action">
          <div className="btn">근무 종료</div>
          <div className="hint">
            <b>18:40</b> 에 종료하면
            <br />
            오늘 몫 8시간을 채웁니다
          </div>
        </div>

        <div className="sect">오늘 기록</div>
        <ul className="chk">
          <li>
            <span className="ico" aria-hidden="true">
              ·
            </span>
            <span>
              <span className="ttl">09:28 – 12:50</span>{" "}
              <span className="txt">사원증</span>
              <br />
              <span className="txt">점심 시간은 근무로 세지 않습니다</span>
            </span>
          </li>
          <li>
            <span className="ico" aria-hidden="true">
              ·
            </span>
            <span>
              <span className="ttl">13:42 – 근무 중</span>{" "}
              <span className="txt">앱</span>
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}

/** 일별 근무 — 눈금은 하루 몫, 나눠 일한 날은 조각으로 */
function ShotDays() {
  return (
    <div className="shot">
      <div className="bar">
        <i />
        <i />
        <i />
        <span>일별 근무</span>
      </div>
      <div className="pane">
        <div className="days">
          <div className="day">
            <span className="d">7/23 수</span>
            <span className="track">
              <span className="seg" style={{ left: "0%", width: "66%" }} />
              <u style={{ left: "66%" }} />
            </span>
            <span className="h">8h 00m</span>
          </div>

          <div className="day">
            <span className="d">7/24 목</span>
            <span className="track">
              <span className="seg" style={{ left: "2%", width: "29%" }} />
              <span
                className="seg gap"
                style={{ left: "31%", width: "27%" }}
              />
              <span className="seg" style={{ left: "58%", width: "21%" }} />
              <u style={{ left: "66%" }} />
            </span>
            <span className="h">6h 00m</span>
          </div>

          <div className="day">
            <span className="d">7/25 금</span>
            <span className="track">
              <span className="seg" style={{ left: "0%", width: "76%" }} />
              <u style={{ left: "66%" }} />
            </span>
            <span className="h">9h 10m</span>
          </div>

          <div className="day">
            <span className="d">7/26 토</span>
            <span className="track">
              <u style={{ left: "66%" }} />
            </span>
            <span className="h muted">—</span>
          </div>

          <div className="day">
            <span className="d">7/28 월</span>
            <span className="track">
              <span className="seg" style={{ left: "0%", width: "27%" }} />
              <u style={{ left: "66%" }} />
            </span>
            <span className="h muted">3h 12m</span>
          </div>
        </div>

        <div className="sect">7월 24일</div>
        <div className="hint">
          08:40 – 12:10 · 19:00 – 21:30 — 사이 6시간 50분은 근무가 아닙니다.
          <br />
          첫 시작과 마지막 종료를 붙여 &ldquo;12시간 50분 근무&rdquo;로 읽히게
          쓰지 않습니다.
        </div>
      </div>
    </div>
  );
}

/** 종료 누락 보정 — 추정치를 미리 채워 준다 */
function ShotFix() {
  return (
    <div className="shot">
      <div className="bar">
        <i />
        <i />
        <i />
        <span>내 기록 보정</span>
      </div>
      <div className="pane">
        <ul className="chk">
          <li>
            <span className="ico warn" aria-hidden="true">
              !
            </span>
            <span>
              <span className="ttl">7월 22일 · 퇴근 기록이 없습니다</span>
              <br />
              <span className="txt">
                0분으로 두지 않습니다. 평소 패턴으로 추정한 시각을 미리 넣어
                두었습니다.
              </span>
            </span>
          </li>
        </ul>

        <div className="fields">
          <div>
            <div className="lab">종료 시각</div>
            <div className="inp">
              18:30 <span className="txt">· 추정</span>
            </div>
          </div>
          <div>
            <div className="lab">사유</div>
            <div className="inp">외근 후 바로 퇴근했습니다</div>
          </div>
        </div>

        <div className="action">
          <div className="btn">보정 요청</div>
          <div className="hint">적은 내용과 시각이 이력으로 남습니다</div>
        </div>
      </div>
    </div>
  );
}

/** 주 52시간 — 정산기간 평균으로 판정하고, 예상은 본인에게만 */
function ShotLimit() {
  return (
    <div className="shot">
      <div className="bar">
        <i />
        <i />
        <i />
        <span>내 근무시간 · 한도</span>
      </div>
      <div className="pane">
        <div className="tiles two">
          <div className="box">
            <div className="k">정산기간 주평균</div>
            <div className="v">44h 30m</div>
          </div>
          <div className="box">
            <div className="k">예상 주평균</div>
            <div className="v">51h 40m</div>
          </div>
        </div>

        <div className="sect">지금 페이스</div>
        <ul className="chk">
          <li>
            <span className="ico warn" aria-hidden="true">
              !
            </span>
            <span>
              <span className="ttl">이 페이스면 한도에 가까워집니다</span>
              <br />
              <span className="txt">
                주 52시간은 개별 주가 아니라 정산기간 평균으로 봅니다. 이 예상은
                본인 화면에만 나옵니다.
              </span>
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}

/** 팀 현황 — 전수 확인이 아니라 이상값만 */
function ShotTeam() {
  return (
    <div className="shot">
      <div className="bar">
        <i />
        <i />
        <i />
        <span>팀 현황 · 플랫폼팀 19명</span>
      </div>
      <div className="pane">
        <div className="pres">
          <div>
            <b>12</b>
            <span>근무 중</span>
          </div>
          <div>
            <b>6</b>
            <span>오프</span>
          </div>
          <div>
            <b>1</b>
            <span>종료 안 됨</span>
          </div>
        </div>

        <div className="sect">확인 필요 · 3건</div>
        <ul className="chk">
          <li>
            <span className="ico crit" aria-hidden="true">
              !
            </span>
            <span>
              <span className="ttl">주 52시간 초과 · 박선우</span>
              <br />
              <span className="txt">정산기간 평균 53h 10m</span>
            </span>
          </li>
          <li>
            <span className="ico warn" aria-hidden="true">
              !
            </span>
            <span>
              <span className="ttl">종료 기록 없음 · 김도윤</span>
              <br />
              <span className="txt">7월 22일</span>
            </span>
          </li>
          <li>
            <span className="ico warn" aria-hidden="true">
              !
            </span>
            <span>
              <span className="ttl">의무근로시간대 미준수 · 한지우</span>
              <br />
              <span className="txt">3일 · 10:00–15:00 기준</span>
            </span>
          </li>
        </ul>

        <div className="sect">구성원 진행률 · 기대선 71%</div>
        <div className="row">
          <span className="n">박선우</span>
          <span className="bar2">
            <i className="over" style={{ width: "96%" }} />
          </span>
          <span className="p">96%</span>
        </div>
        <div className="row">
          <span className="n">김도윤</span>
          <span className="bar2">
            <i style={{ width: "67%" }} />
          </span>
          <span className="p">67%</span>
        </div>
        <div className="row">
          <span className="n">한지우</span>
          <span className="bar2">
            <i style={{ width: "54%" }} />
          </span>
          <span className="p">54%</span>
        </div>
      </div>
    </div>
  );
}

export default function IntroPage() {
  return (
    <main className="kn">
      {/* ── 표지 ── */}
      <section className="top">
        <div className="wrap">
          <div className="brandline">
            <span className="mark" aria-hidden="true">
              F
            </span>
            flex-attendance
          </div>

          <h1>
            출근 시각을
            <br />
            정하지 않습니다.
          </h1>

          <p className="lead">
            9시에 오지 않아도 됩니다. 정산기간 안에 <b>총 근무시간</b>만 맞추면
            됩니다. 얼마나 채웠고 얼마가 남았는지는 앱이 셉니다.
          </p>

          <div className="cta">
            <Link href="/login" className="solid">
              로그인
            </Link>
            <a href="#today" className="ghost">
              무엇이 되는지 보기
            </a>
          </div>

          <div style={{ maxWidth: 620, margin: "clamp(44px, 7vw, 76px) auto 0" }}>
            <ShotDashboard />
          </div>
        </div>
      </section>

      {/* ── 체크인 ── */}
      <section id="today">
        <div className="wrap split rise">
          <div className="copy">
            <div className="eyebrow">출퇴근</div>
            <h2>
              버튼 하나로 시작하고,
              <br />
              버튼 하나로 끝냅니다.
            </h2>
            <p className="body">
              지금까지 몇 시간 일했는지, <b>몇 시에 종료하면 오늘 몫을 채우는지</b>
              를 버튼 옆에 적어 둡니다. 계산은 사용자가 하지 않습니다.
            </p>
            <p className="body dim">
              사원증을 찍었으면 앱에 다시 찍지 않아도 됩니다. 같은 근무로 보이면
              합쳐서 한 번만 셉니다.
            </p>
          </div>
          <ShotToday />
        </div>
      </section>

      {/* ── 나눠 일하기 ── */}
      <section className="light">
        <div className="wrap statement rise">
          <div className="eyebrow">하루를 나눠 일해도</div>
          <p className="huge">
            3<span className="unit">시간</span>
            <span className="op">+</span>2<span className="unit">시간</span>
            <span className="op">=</span>
            <em>
              5<span className="unit">시간</span>
            </em>
          </p>
          <p className="lead" style={{ margin: "28px auto 0" }}>
            오전에 세 시간, 저녁에 두 시간. 사이에 비운 시간은 근무가 아닙니다.
            몇 번으로 나눠도 <b>실제로 일한 시간만</b> 더합니다.
          </p>

          <div
            style={{ maxWidth: 720, margin: "clamp(40px, 6vw, 64px) auto 0" }}
          >
            <ShotDays />
          </div>
        </div>
      </section>

      {/* ── 보정 ── */}
      <section>
        <div className="wrap split flip rise">
          <div className="copy">
            <div className="eyebrow">깜빡한 날</div>
            <h2>
              정직하게 적는 사람이
              <br />
              불리해지지 않습니다.
            </h2>
            <p className="body">
              종료를 깜빡했다면 빈칸을 채우라고 하지 않습니다. 평소 패턴으로{" "}
              <b>추정한 시각을 미리 넣어 두고</b>, 사유를 적어 확정하면 그대로
              기록이 됩니다.
            </p>
            <p className="body dim">
              보정을 몇 번 했는지로 사람을 보지 않습니다. 외근이 잦은 사람,
              사원증을 두고 온 사람이 정직할수록 의심받는 구조를 만들지
              않았습니다.
            </p>
          </div>
          <ShotFix />
        </div>
      </section>

      {/* ── 주 52시간 ── */}
      <section>
        <div className="wrap split rise">
          <div className="copy">
            <div className="eyebrow">법정 한도</div>
            <h2>
              주 52시간을
              <br />
              평균으로 봅니다.
            </h2>
            <p className="body">
              선택적 근로시간제에서 한도는 개별 주가 아니라{" "}
              <b>정산기간 평균</b>으로 판정합니다. 한 주 몰아 일하고 다음 주를
              줄이는 것이 위법이 되지 않아야 자율 출근제가 성립합니다.
            </p>
            <p className="body dim">
              이 페이스면 어디에 닿는지는 <b>본인 화면에만</b> 나옵니다. 팀장
              화면에 &ldquo;넘길 것 같은 사람&rdquo;이 뜨면, 줄이는 것이 근무가
              아니라 기록이 됩니다.
            </p>
          </div>
          <ShotLimit />
        </div>
      </section>

      {/* ── 팀장 · HR ── */}
      <section className="light">
        <div className="wrap split flip rise">
          <div className="copy">
            <div className="eyebrow">팀장 · HR</div>
            <h2>
              200명을
              <br />
              다 보지 않습니다.
            </h2>
            <p className="body">
              전원 목록을 훑는 화면이 아닙니다. <b>확인이 필요한 것만</b> 올라옵니다
              — 한도 초과, 종료 안 된 근무, 의무근로시간대 미준수.
            </p>
            <p className="body dim">
              재실은 근무 중 · 오프 · 종료 안 됨 세 숫자로 봅니다. 진행률에는
              지난 영업일만큼의 기대선이 함께 그려져서, 늦은 사람과 그냥 다르게
              일하는 사람이 구분됩니다.
            </p>
          </div>
          <ShotTeam />
        </div>
      </section>

      {/* ── 나머지 기능 ── */}
      <section
        className="light"
        style={{ paddingTop: 0, paddingBottom: "clamp(64px, 9vw, 112px)" }}
      >
        <div className="wrap rise">
          <div className="quad">
            <div className="note">
              <h3>휴가</h3>
              <p>
                신청하면 팀장·HR 이 승인합니다. 승인된 날만 소정근로에서
                빠집니다. 반려에는 사유가 붙고, 그 날짜는 다시 신청할 수
                있습니다.
              </p>
            </div>
            <div className="note">
              <h3>마감</h3>
              <p>
                정산기간은 유예 3일 뒤 마감되고 그때 숫자가 얼어붙습니다. 늦게
                도착한 기록으로 값이 달라지면 <b>&ldquo;마감 후 바뀌었습니다&rdquo;</b>
                로 알려줍니다.
              </p>
            </div>
            <div className="note">
              <h3>알림</h3>
              <p>
                읽음 표시가 없습니다. <b>확인할 항목</b>만 있고, 해결하면 저절로
                사라집니다. 다 읽었는데 배지가 남아 있는 일이 없습니다.
              </p>
            </div>
            <div className="note">
              <h3>사원증 기록</h3>
              <p>
                출입 기록 파일을 올리면 앱 기록과 함께 봅니다. 겹치는 구간은
                합쳐서 이중으로 세지 않고, 잘못 올린 파일은 그 배치만 되돌립니다.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 역할 ── */}
      <section>
        <div className="wrap rise">
          <div className="eyebrow">보이는 것이 사람마다 다릅니다</div>
          <h2>내 시간은 나만, 집계는 모두.</h2>

          <div className="quad">
            <div className="note">
              <span className="who">사원</span>
              <h3>내 시간</h3>
              <p>
                남은 시간, 일별 근무, 보정, 휴가 신청. 예상 한도는 여기에만
                나옵니다.
              </p>
            </div>
            <div className="note">
              <span className="who">팀장</span>
              <h3>우리 팀</h3>
              <p>재실과 확인 필요, 팀원 상세, 휴가 승인. 팀 범위까지입니다.</p>
            </div>
            <div className="note">
              <span className="who">HR</span>
              <h3>규칙과 기록</h3>
              <p>
                근태 규칙, 사원증 파일 반영, 마감과 재마감, 사용자·팀 관리.
              </p>
            </div>
            <div className="note">
              <span className="who">임원</span>
              <h3>집계만</h3>
              <p>
                전사·팀별 집계와 내보내기. <b>개인 상세는 열리지 않습니다.</b>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 맺음 ── */}
      <footer>
        <div className="wrap">
          <h2>회사의 규칙에 맞춥니다.</h2>
          <p className="lead" style={{ margin: "20px auto 0" }}>
            정산기간, 주 시작일, 의무근로시간대, 휴게, 1일 상한, 공휴일. HR 이
            설정하면 전 직원 집계를 원본에서 다시 계산합니다.
          </p>

          <div className="cta">
            <Link href="/login" className="solid">
              로그인
            </Link>
          </div>

          <p className="fine">
            선택적 근로시간제는 근로기준법 §52 에 따라 <b>서면합의</b>가
            필요합니다. 의무근로시간대·휴게(§54)·1일 상한은 합의한 내용을 그대로
            넣어야 하고, 앱의 기본값은 예시입니다. 근무 기록과 열람 이력은 사내에
            남고 외부로 보내지 않습니다.
          </p>
          <p className="fine">
            이 화면의 숫자는 설명을 위한 예시입니다.
          </p>
        </div>
      </footer>
    </main>
  );
}
