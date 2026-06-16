import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  platform: "node",
  target: "node18",
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
});
