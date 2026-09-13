import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const api = process.env.API_PROXY_TARGET;
    return api ? [{ source: "/api/:path*", destination: `${api}/:path*` }] : [];
  },
};

export default nextConfig;
