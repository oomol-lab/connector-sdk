import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  // Inject the version the same way the build does, so source run under vitest sees
  // __PKG_VERSION__ defined (matching the built artifact) — no runtime fallback needed.
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Type-only modules (interfaces / type aliases) emit no runtime code.
      exclude: ["src/registry.ts", "src/types.ts"],
      reporter: ["text", "html"],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
