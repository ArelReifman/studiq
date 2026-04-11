import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@studiq/types", "@studiq/api"],
  output: "standalone",
  webpack: (config) => {
    // Resolve .js imports to .ts files (needed for API package using NodeNext module resolution)
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
