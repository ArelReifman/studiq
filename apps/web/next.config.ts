import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@studiq/types"],
  output: "standalone",
};

export default nextConfig;
