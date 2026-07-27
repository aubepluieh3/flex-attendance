/** @type {import('next').NextConfig} */
const nextConfig = {
  // TypeScript 7은 Next가 기대하는 compiler API를 제공하지 않는다.
  // TS를 6으로 내리는 대신 Next의 TypeScript CLI 경로를 쓴다.
  experimental: {
    useTypeScriptCli: true,
  },
};

export default nextConfig;
