import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // drizzle-kit/api ships an esbuild bundle that uses dynamic require() for
    // node builtins. Inline it so vitest's CJS interop resolves those rather
    // than hitting the bundle's "Dynamic require of fs is not supported" shim.
    // Used only by the pglite test helper; no effect on production.
    server: {
      deps: {
        inline: ["drizzle-kit"],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json"],
      exclude: ["node_modules/", "dist/", "src/db/migrate.ts"],
    },
  },
});
