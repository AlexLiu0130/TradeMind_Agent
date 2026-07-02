import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: "/Users/liuqiyu/Desktop/qveris/TradeMind_Agent/dashboard",
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    root: "/Users/liuqiyu/Desktop/qveris/TradeMind_Agent/dashboard",
  },
};

export default nextConfig;
