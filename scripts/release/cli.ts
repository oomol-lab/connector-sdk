/**
 * Release workflow CLI. Run a single step with `bun run scripts/release/cli.ts <command>`:
 *
 *   compute-version         Resolve the version from git tags + workflow inputs and export
 *                           RELEASE_VERSION / RELEASE_TAG / PREVIOUS_TAG to later job steps.
 *   set-version             Write RELEASE_VERSION into package.json (so the build bakes the
 *                           matching __PKG_VERSION__ before publish).
 *   publish                 Publish the current package to npm (idempotent; skips if the
 *                           version already exists). In CI it authenticates via npm OIDC
 *                           trusted publishing (no token) and adds --provenance.
 *   create-github-release   Create the git tag + GitHub release at GITHUB_SHA (idempotent).
 *
 * Inputs are read from the environment so the same script works as plain CI steps:
 *   compute-version  ← EXPECTED_VERSION, VERSION_BUMP
 *   set-version      ← RELEASE_VERSION
 *   publish          ← RELEASE_VERSION, GITHUB_ACTIONS (auth via OIDC trusted publishing in CI)
 *   create-release   ← RELEASE_TAG, PREVIOUS_TAG, GITHUB_SHA, GH_TOKEN
 */

import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  listGitTags,
  readPackageName,
  readPackageVersion,
  readRequiredEnv,
  runCapture,
  runInherit,
  setPackageVersion,
  writeGitHubEnv,
} from "./lib";
import {
  computeReleaseVersion,
  isStableSemver,
  readVersionBump,
} from "./version";

// Run everything from the repo root regardless of the caller's cwd, so git/npm/gh and the
// relative package.json path all resolve correctly.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
process.chdir(repoRoot);
const packageJsonPath = "package.json";

async function runComputeVersion(): Promise<void> {
  const baseVersion = await readPackageVersion(packageJsonPath);
  const result = computeReleaseVersion({
    expectedVersion: process.env.EXPECTED_VERSION ?? "",
    versionBump: readVersionBump(process.env.VERSION_BUMP ?? "patch"),
    tags: listGitTags(),
    baseVersion: isStableSemver(baseVersion) ? baseVersion : "0.0.0",
  });

  await writeGitHubEnv({
    RELEASE_VERSION: result.version,
    RELEASE_TAG: result.tagName,
    PREVIOUS_TAG: result.previousTag,
  });
  process.stdout.write(
    `Release version ${result.version} (tag ${result.tagName}, previous ${result.previousTag || "none"}).\n`,
  );
}

async function runSetVersion(): Promise<void> {
  const version = readRequiredEnv("RELEASE_VERSION");
  await setPackageVersion(packageJsonPath, version);
  process.stdout.write(`Set package.json version to ${version}.\n`);
}

function npmVersionExists(packageSpec: string): boolean {
  const result = runCapture("npm", ["view", packageSpec, "version", "--json"]);
  if (result.status === 0) {
    return result.stdout.trim() !== "";
  }

  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (output.includes("e404") || output.includes("no match found")) {
    return false;
  }
  throw new Error(`Failed to query npm for ${packageSpec}:\n${(result.stderr || result.stdout).trim()}`);
}

async function runPublish(): Promise<void> {
  const version = readRequiredEnv("RELEASE_VERSION");
  const name = await readPackageName(packageJsonPath);
  const packageSpec = `${name}@${version}`;

  if (npmVersionExists(packageSpec)) {
    process.stdout.write(`Skipping publish: ${packageSpec} already exists on npm.\n`);
    return;
  }

  const args = ["publish", "--access", "public"];
  // In CI npm authenticates via OIDC trusted publishing; provenance rides on the same
  // id-token (id-token: write). Neither is available locally, so add --provenance only here.
  if (process.env.GITHUB_ACTIONS === "true") {
    args.push("--provenance");
  }
  runInherit("npm", args);
  process.stdout.write(`Published ${packageSpec}.\n`);
}

function gitHubReleaseExists(tag: string): boolean {
  return runCapture("gh", ["release", "view", tag, "--json", "tagName"]).status === 0;
}

function runCreateGitHubRelease(): void {
  const tag = readRequiredEnv("RELEASE_TAG");

  if (gitHubReleaseExists(tag)) {
    process.stdout.write(`Skipping GitHub release: ${tag} already exists.\n`);
    return;
  }

  const previousTag = process.env.PREVIOUS_TAG ?? "";
  const args = [
    "release",
    "create",
    tag,
    "--target",
    readRequiredEnv("GITHUB_SHA"),
    "--title",
    tag,
    "--generate-notes",
  ];
  if (previousTag !== "") {
    args.push("--notes-start-tag", previousTag);
  }
  args.push("--latest");

  runInherit("gh", args);
  process.stdout.write(`Created GitHub release ${tag}.\n`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case "compute-version":
      await runComputeVersion();
      return;
    case "set-version":
      await runSetVersion();
      return;
    case "publish":
      await runPublish();
      return;
    case "create-github-release":
      runCreateGitHubRelease();
      return;
    default:
      throw new Error(
        `Unknown command: ${command ?? "(none)"}. `
        + "Expected one of: compute-version, set-version, publish, create-github-release.",
      );
  }
}

await main();
