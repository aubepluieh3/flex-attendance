/**
 * 보안 헤더.
 *
 * 근태 데이터는 개인정보다. 사내에 배포하더라도 사내망이 곧 안전은 아니다.
 *
 * CSP 는 여기 넣지 않았다. Next 는 RSC 페이로드를 인라인 <script> 로 심으므로
 * script-src 'self' 만으로는 앱이 죽고, 'unsafe-inline' 을 허용하면 CSP 의
 * XSS 방어력이 거의 사라진다 — 있는 척하는 보안이 된다. 제대로 하려면
 * middleware 로 nonce 를 발급해야 하는데 실측이 필요해서 따로 잡는다.
 */
const securityHeaders = [
  /*
   * HTTPS 강제. max-age 1년.
   * HTTP 로 서비스하는 개발 환경에는 영향이 없다(브라우저가 무시한다).
   */
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  /* 선언한 것과 다른 타입으로 실행되는 것을 막는다 */
  { key: "X-Content-Type-Options", value: "nosniff" },
  /* iframe 안에 넣어 클릭을 훔치는 것을 막는다 */
  { key: "X-Frame-Options", value: "DENY" },
  /* 외부로 나갈 때 경로·쿼리를 흘리지 않는다 — 쿼리에 기간·사번이 들어간다 */
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  /* 근태 앱이 쓸 이유가 없는 장치는 전부 막는다 */
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // TypeScript 7은 Next가 기대하는 compiler API를 제공하지 않는다.
  // TS를 6으로 내리는 대신 Next의 TypeScript CLI 경로를 쓴다.
  experimental: {
    useTypeScriptCli: true,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
