/**
 * Side-effect helpers for the Release workflow: git, npm/gh subprocesses,
 * package.json I/O, and GitHub Actions env wiring.
 *
 * Node built-ins only (no `Bun.*`) so `tsc --noEmit` with `types: ["node"]` stays green;
 * the scripts still run under `bun run`.
 */

import { spawnSync } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import process from "node:process";

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Runs a command and captures its output. Use for queries (git tags, npm view). */
export function runCapture(command: string, args: readonly string[]): CommandResult {
  const result = spawnSync(command, [...args], { encoding: "utf8" });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Runs a command with inherited stdio (so its output streams to the CI log) and throws
 * on a non-zero exit. Use for side-effecting steps (npm publish, gh release create).
 */
export function runInherit(
  command: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
): void {
  const result = spawnSync(command, [...args], {
    stdio: "inherit",
    env: env ?? process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with code ${result.status ?? "unknown"}.`);
  }
}

/** Lists `vX.Y.Z`-style tags newest-first; returns `[]` when the repo has no matching tags. */
export function listGitTags(): string[] {
  const result = runCapture("git", ["tag", "-l", "v*", "--sort=-v:refname"]);
  if (result.status !== 0) {
    throw new Error(`Failed to list git tags: ${result.stderr.trim() || "unknown error"}`);
  }
  return result.stdout
    .split("\n")
    .map(tag => tag.trim())
    .filter(tag => tag !== "");
}

interface PackageManifest {
  name?: unknown;
  version?: unknown;
}

async function readManifest(packageJsonPath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
}

export async function readPackageVersion(packageJsonPath: string): Promise<string> {
  const manifest = await readManifest(packageJsonPath) as PackageManifest;
  return typeof manifest.version === "string" ? manifest.version : "";
}

export async function readPackageName(packageJsonPath: string): Promise<string> {
  const manifest = await readManifest(packageJsonPath) as PackageManifest;
  if (typeof manifest.name !== "string" || manifest.name === "") {
    throw new Error(`package.json at ${packageJsonPath} is missing a "name".`);
  }
  return manifest.name;
}

/** Writes `version` into package.json, preserving key order and 2-space formatting. */
export async function setPackageVersion(packageJsonPath: string, version: string): Promise<void> {
  const manifest = await readManifest(packageJsonPath);
  manifest.version = version;
  await writeFile(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/**
 * Exports `key=value` pairs to later steps of the same job via `$GITHUB_ENV`.
 * Outside Actions (no `$GITHUB_ENV`) it just prints them, so local dry-runs work.
 */
export async function writeGitHubEnv(entries: Record<string, string>): Promise<void> {
  const text = `${Object.entries(entries).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
  const githubEnvPath = process.env.GITHUB_ENV;
  if (githubEnvPath === undefined || githubEnvPath === "") {
    process.stdout.write(text);
    return;
  }
  await appendFile(githubEnvPath, text, "utf8");
}

export function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required.`);
  }
  return value;
}
