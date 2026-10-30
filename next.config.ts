import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  serverExternalPackages: ["ioredis", "bullmq", "telegram", "imapflow", "nodemailer", "mailparser"],
  async headers() {
    return [
      {
        source: "/chat",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [{ source: "/favicon.ico", destination: "/api/site/favicon" }],
    };
  },
  images: {
    remotePatterns: [],
    unoptimized: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "80mb",
    },
  },
};

export default nextConfig;
