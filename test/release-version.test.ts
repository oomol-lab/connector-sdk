import { describe, expect, it } from "vitest";

import {
  bumpVersion,
  computeReleaseVersion,
  findLatestStableTag,
  isStableSemver,
  normalizeExpectedVersion,
  parseStableTag,
  readVersionBump,
} from "../scripts/release/version";

describe("isStableSemver / parseStableTag", () => {
  it("accepts only three numeric segments", () => {
    expect(isStableSemver("1.2.3")).toBe(true);
    expect(isStableSemver("0.0.0")).toBe(true);
    expect(isStableSemver("1.2")).toBe(false);
    expect(isStableSemver("1.2.3.4")).toBe(false);
    expect(isStableSemver("1.2.3-beta.1")).toBe(false);
    expect(isStableSemver("v1.2.3")).toBe(false);
    expect(isStableSemver("1.2.x")).toBe(false);
  });

  it("parses stable tags and rejects pre-releases", () => {
    expect(parseStableTag("v1.2.3")).toBe("1.2.3");
    expect(parseStableTag("1.2.3")).toBeUndefined();
    expect(parseStableTag("v1.2.3-rc.1")).toBeUndefined();
    expect(parseStableTag("vnope")).toBeUndefined();
  });
});

describe("normalizeExpectedVersion", () => {
  it("strips a leading v and validates the format", () => {
    expect(normalizeExpectedVersion("1.2.3")).toBe("1.2.3");
    expect(normalizeExpectedVersion("v1.2.3")).toBe("1.2.3");
  });

  it("throws on non X.Y.Z input", () => {
    expect(() => normalizeExpectedVersion("1.2")).toThrow(/X\.Y\.Z/);
    expect(() => normalizeExpectedVersion("1.2.3-beta")).toThrow(/X\.Y\.Z/);
  });
});

describe("bumpVersion", () => {
  it("bumps each segment and resets lower ones", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("throws on an unbumpable version", () => {
    expect(() => bumpVersion("1.2", "patch")).toThrow();
  });
});

describe("readVersionBump", () => {
  it("accepts the three valid segments", () => {
    expect(readVersionBump("patch")).toBe("patch");
    expect(readVersionBump("minor")).toBe("minor");
    expect(readVersionBump("major")).toBe("major");
  });

  it("throws on anything else", () => {
    expect(() => readVersionBump("")).toThrow();
    expect(() => readVersionBump(undefined)).toThrow();
    expect(() => readVersionBump("pre")).toThrow();
  });
});

describe("findLatestStableTag", () => {
  it("returns the first stable tag (tags arrive newest-first)", () => {
    expect(findLatestStableTag(["v2.0.0", "v1.9.0"])).toBe("v2.0.0");
  });

  it("skips pre-release tags", () => {
    expect(findLatestStableTag(["v2.0.0-rc.1", "v1.9.0"])).toBe("v1.9.0");
  });

  it("returns empty string when there are no stable tags", () => {
    expect(findLatestStableTag([])).toBe("");
    expect(findLatestStableTag(["v1.0.0-beta"])).toBe("");
  });
});

describe("computeReleaseVersion", () => {
  it("bumps from the latest stable tag", () => {
    expect(
      computeReleaseVersion({
        expectedVersion: "",
        versionBump: "minor",
        tags: ["v1.4.0", "v1.3.0"],
        baseVersion: "0.1.0",
      }),
    ).toEqual({ version: "1.5.0", tagName: "v1.5.0", previousTag: "v1.4.0" });
  });

  it("honors an explicit expected version over the bump", () => {
    expect(
      computeReleaseVersion({
        expectedVersion: "v3.0.0",
        versionBump: "patch",
        tags: ["v1.4.0"],
        baseVersion: "0.1.0",
      }),
    ).toEqual({ version: "3.0.0", tagName: "v3.0.0", previousTag: "v1.4.0" });
  });

  it("falls back to the package.json version when no tags exist", () => {
    expect(
      computeReleaseVersion({
        expectedVersion: "",
        versionBump: "patch",
        tags: [],
        baseVersion: "0.1.0",
      }),
    ).toEqual({ version: "0.1.1", tagName: "v0.1.1", previousTag: "" });
  });

  it("falls back to 0.0.0 when the base version is not stable semver", () => {
    expect(
      computeReleaseVersion({
        expectedVersion: "",
        versionBump: "minor",
        tags: [],
        baseVersion: "0.1.0-dev",
      }),
    ).toEqual({ version: "0.1.0", tagName: "v0.1.0", previousTag: "" });
  });

  it("refuses to reuse an existing tag", () => {
    expect(() =>
      computeReleaseVersion({
        expectedVersion: "1.4.0",
        versionBump: "patch",
        tags: ["v1.4.0"],
        baseVersion: "0.1.0",
      }),
    ).toThrow(/already exists/);
  });
});
