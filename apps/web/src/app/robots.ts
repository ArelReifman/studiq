import type { MetadataRoute } from "next";

// Served at /robots.txt. The app is login-gated — only the auth surface is
// worth crawling; everything behind it is disallowed.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/teacher", "/student", "/auth", "/api"],
    },
  };
}
