/**
 * Type-level acceptance runner.
 *
 * 1. Builds the package (tsd + resolution fixtures resolve `@oomol-lab/connector` via the
 *    self-symlink in node_modules → package.json exports → dist/*.d.ts).
 * 2. Runs the three-state tsd assertions (no-B / with-B / partial-B).
 * 3. Type-checks the positive-only consumer across moduleResolution modes
 *    (bundler / node16 / nodenext / classic node10).
 *
 * Exits non-zero on any failure.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = join(root, "node_modules", ".bin", "tsc");
const tsd = join(root, "node_modules", ".bin", "tsd");

// The fixtures resolve `@oomol-lab/connector` via a self-symlink in node_modules → the
// package root (→ package.json `exports` → dist/*.d.ts), so they exercise the REAL published
// resolution. `bun install` does not create this, so ensure it here (idempotent, CI-safe).
function ensureSelfLink(): void {
  const scopeDir = join(root, "node_modules", "@oomol-lab");
  const link = join(scopeDir, "connector");
  if (existsSync(link)) return;
  mkdirSync(scopeDir, { recursive: true });
  symlinkSync("../..", link, "dir");
}
ensureSelfLink();

let failures = 0;
function run(label: string, cmd: string, args: string[], cwd = root): void {
  process.stdout.write(`\n▶ ${label}\n`);
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (res.status === 0) {
    process.stdout.write(`✓ ${label}\n`);
  } else {
    process.stdout.write(`✗ ${label} (exit ${res.status})\n`);
    failures++;
  }
}

// 1. Build (produces dist/index.d.ts + dist/index.d.cts used by the fixtures). Always rebuild
// so the fixtures never type-check against a stale declaration file.
run("build", join(root, "node_modules", ".bin", "tsdown"), []);

// 2. Three-state tsd assertions.
for (const state of ["no-b", "with-b", "partial-b"]) {
  run(`tsd: ${state}`, tsd, [`fixtures/consumer/${state}`, "--files", "index.test-d.ts"]);
}

// 3. Resolution matrix (positive-only consumer).
const resolutionDir = join(root, "fixtures", "resolution");
for (const mode of ["bundler", "node16", "nodenext", "node-classic"]) {
  run(`resolution: ${mode}`, tsc, ["-p", `tsconfig.${mode}.json`], resolutionDir);
}

// 4. Type-check the published examples against the built package (resolves via the symlink).
run("examples", tsc, ["-p", "tsconfig.json"], join(root, "examples"));

if (failures > 0) {
  process.stderr.write(`\n${failures} type-acceptance check(s) failed.\n`);
  process.exit(1);
}
process.stdout.write("\nAll type-acceptance checks passed.\n");
