import { afterEach, expect, test, vi } from "vitest";

const version = "0.4.1-beta.2";
const metadata = `version: ${version}\n  - url: Harbor.Player-${version}-x64-unsigned-Setup.exe\npath: Harbor.Player-${version}-x64-unsigned-Setup.exe\n`;
const names = [
  `Harbor.Player-${version}-x64-unsigned-Setup.exe`,
  `Harbor.Player-${version}-x64-unsigned-Setup.exe.blockmap`,
  `Harbor.Player-${version}-x64-unsigned-portable.exe`,
  "beta.yml",
];
const originalArgs = process.argv;
afterEach(() => {
  process.argv = originalArgs;
  vi.doUnmock("node:fs/promises");
  vi.doUnmock("node:child_process");
  vi.restoreAllMocks();
  vi.resetModules();
});

async function verify(
  overrides: {
    missing?: boolean;
    size?: number;
    isDraft?: boolean;
    isPrerelease?: boolean;
    metadata?: string;
  } = {},
) {
  vi.resetModules();
  process.argv = [
    "node",
    "verify-release.mjs",
    `v${version}`,
    "--channel=beta",
    "--artifacts",
    "--published",
  ];
  vi.doMock("node:fs/promises", () => ({
    access: vi.fn(async () => {}),
    stat: vi.fn(async () => ({ size: 100 })),
    readFile: vi.fn(async (file: string) =>
      file === "package.json" ? JSON.stringify({ version }) : metadata,
    ),
  }));
  const gh = vi.fn((_command: string, args: string[]) => {
    if (args[1] === "view")
      return JSON.stringify({
        tagName: `v${version}`,
        isDraft: overrides.isDraft ?? false,
        isPrerelease: overrides.isPrerelease ?? true,
        assets: names.slice(overrides.missing ? 1 : 0).map((name) => ({
          name,
          state: "uploaded",
          size: overrides.size ?? 100,
        })),
        url:
          "https://github.com/grouzdev/harbor-player/releases/tag/" +
          `v${version}`,
      });
    return overrides.metadata ?? metadata;
  });
  vi.doMock("node:child_process", () => ({ execFileSync: gh }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  await import("../scripts/verify-release.mjs");
  expect(gh).toHaveBeenCalledTimes(2);
}

test("verifies the published channel, every asset and exact metadata", async () => {
  await verify();
});

test.each([
  { missing: true },
  { size: 99 },
  { isDraft: true },
  { isPrerelease: false },
  { metadata: "different metadata" },
])(
  "rejects incomplete or mismatched published output %j",
  async (overrides) => {
    await expect(verify(overrides)).rejects.toThrow();
  },
);
