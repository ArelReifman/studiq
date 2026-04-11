import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@studiq/types", "@studiq/api"],
  output: "standalone",
};

export default nextConfig;
