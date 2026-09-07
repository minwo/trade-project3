import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    reactStrictMode: true,
    // legacy/ 에는 프로토타입(순수 HTML/JS)이 들어 있으므로 빌드에서 제외한다.
    eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
