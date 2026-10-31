import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import electronUpdater from "electron-updater";
import { PublishedReleaseProvider } from "../src/desktop/published-release-provider.js";

const { NsisUpdater } = electronUpdater;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function release(version: string, overrides = {}) {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: version.includes("-"),
    published_at: "2026-10-31T10:00:00Z",
    assets: [
      {
        name: version.includes("-") ? "beta.yml" : "latest.yml",
        state: "uploaded",
      },
    ],
    ...overrides,
  };
}

function metadata(version: string) {
  return `version: ${version}
files:
  - url: Harbor.Player-${version}-x64-unsigned-Setup.exe
    sha512: ${Buffer.alloc(64).toString("base64")}
    size: 100
path: Harbor.Player-${version}-x64-unsigned-Setup.exe
sha512: ${Buffer.alloc(64).toString("base64")}
releaseDate: '2026-10-31T10:00:00Z'
`;
}

async function fixture(currentVersion = "0.4.1-beta.1", channel = "beta") {
  const requests: string[] = [];
  const responses = new Map<string, { status?: number; body: string }>();
  const server = createServer((request, response) => {
    const url = request.url!.split("?")[0];
    requests.push(request.url!);
    const result = responses.get(request.url!) ?? responses.get(url);
    response.writeHead(result?.status ?? (result ? 200 : 404));
    response.end(result?.body ?? "not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test address");
  const base = `http://127.0.0.1:${address.port}`;
  const directory = mkdtempSync(path.join(os.tmpdir(), "harbor-provider-"));
  cleanups.push(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(directory, { recursive: true, force: true });
  });
  // Real AppUpdater, provider parsing and version comparisons. Only Electron's
  // HTTP transport is replaced by Node fetch against the local HTTP fixture.
  const updater = new NsisUpdater(null, {
    version: currentVersion,
    name: "Harbor Player",
    isPackaged: true,
    appUpdateConfigPath: path.join(directory, "app-update.yml"),
    userDataPath: directory,
    baseCachePath: directory,
    whenReady: async () => {},
    relaunch() {},
    quit() {},
    onQuit() {},
  });
  updater.logger = null;
  updater.autoDownload = false;
  updater.channel = channel;
  updater.allowPrerelease = channel === "beta";
  updater.allowDowngrade = false;
  Object.defineProperty(updater, "httpExecutor", {
    value: {
      async request(options: {
        protocol: string;
        hostname: string;
        port: string;
        path: string;
      }) {
        const response = await fetch(
          `${options.protocol}//${options.hostname}:${options.port}${options.path}`,
        );
        if (!response.ok)
          throw Object.assign(new Error(`HTTP error: ${response.status}`), {
            statusCode: response.status,
          });
        return response.text();
      },
    },
  });
  let provider: PublishedReleaseProvider;
  class LocalProvider extends PublishedReleaseProvider {
    protected apiBase = `${base}/releases`;
    protected downloadBase = `${base}/download/`;
    constructor(
      ...args: ConstructorParameters<typeof PublishedReleaseProvider>
    ) {
      super(...args);
      provider = this;
    }
  }
  updater.setFeedURL({ provider: "custom", updateProvider: LocalProvider });
  return { updater, responses, requests, getProvider: () => provider };
}

test("ignores bare tags, drafts, unpublished and foreign-channel releases", async () => {
  const { updater, responses, requests, getProvider } = await fixture();
  responses.set("/releases", {
    body: JSON.stringify([
      // Bare tags are absent from this endpoint; Atom is never requested.
      release("0.9.0-beta.1", { draft: true }),
      release("0.8.0-beta.1", { published_at: null }),
      release("1.0.0"),
      release("0.5.0-alpha.1"),
      release("0.4.0-beta.2"),
      release("0.4.1-beta.2"),
    ]),
  });
  responses.set("/download/v0.4.1-beta.2/beta.yml", {
    body: metadata("0.4.1-beta.2"),
  });
  const result = await updater.checkForUpdates();
  expect(result?.isUpdateAvailable).toBe(true);
  expect(result?.updateInfo.version).toBe("0.4.1-beta.2");
  expect(result?.updateInfo.files[0].sha512).toBe(
    Buffer.alloc(64).toString("base64"),
  );
  expect(requests).toEqual([
    "/releases?per_page=100&page=1",
    "/download/v0.4.1-beta.2/beta.yml",
  ]);
  expect(result?.downloadPromise).toBeNull();
  const files = getProvider().resolveFiles(result!.updateInfo);
  expect(files[0].url.pathname).toBe(
    "/download/v0.4.1-beta.2/Harbor.Player-0.4.1-beta.2-x64-unsigned-Setup.exe",
  );
  expect(files[0].info.sha512).toBe(Buffer.alloc(64).toString("base64"));
});

test.each(["0.4.1-beta.1", "0.4.0-beta.2"])(
  "real updater reports no update for equal/older published version %s",
  async (version) => {
    const { updater, responses } = await fixture();
    responses.set("/releases", { body: JSON.stringify([release(version)]) });
    responses.set(`/download/v${version}/beta.yml`, {
      body: metadata(version),
    });
    expect((await updater.checkForUpdates())?.isUpdateAvailable).toBe(false);
  },
);

test("stable channel excludes beta releases", async () => {
  const { updater, responses, requests } = await fixture("0.4.0", "latest");
  responses.set("/releases", {
    body: JSON.stringify([release("0.6.0-beta.1"), release("0.4.1")]),
  });
  responses.set("/download/v0.4.1/latest.yml", { body: metadata("0.4.1") });
  expect((await updater.checkForUpdates())?.updateInfo.version).toBe("0.4.1");
  expect(requests.some((url) => url.includes("beta.yml"))).toBe(false);
});

test.each([
  {
    name: "missing asset",
    entry: release("0.4.1-beta.2", { assets: [] }),
    status: 200,
    body: metadata("0.4.1-beta.2"),
    code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
  },
  {
    name: "404",
    entry: release("0.4.1-beta.2"),
    status: 404,
    body: "",
    statusCode: 404,
  },
  {
    name: "outage",
    entry: release("0.4.1-beta.2"),
    status: 503,
    body: "",
    statusCode: 503,
  },
  {
    name: "corrupt metadata",
    entry: release("0.4.1-beta.2"),
    status: 200,
    body: "[invalid: yaml",
    code: "ERR_UPDATER_INVALID_UPDATE_INFO",
  },
  {
    name: "wrong version",
    entry: release("0.4.1-beta.2"),
    status: 200,
    body: metadata("0.4.1-beta.3"),
    code: "ERR_UPDATER_INVALID_UPDATE_INFO",
  },
])(
  "does not hide published metadata failure: $name",
  async ({ entry, status, body, code, statusCode }) => {
    const { updater, responses, requests } = await fixture();
    responses.set("/releases", {
      body: JSON.stringify([entry, release("0.4.0-beta.2")]),
    });
    responses.set("/download/v0.4.1-beta.2/beta.yml", { status, body });
    await expect(updater.checkForUpdates()).rejects.toMatchObject(
      code ? { code } : { statusCode },
    );
    expect(
      requests.some(
        (url) => url.includes("latest.yml") || url.includes("v0.4.0"),
      ),
    ).toBe(false);
  },
);

test.each([403, 404, 503])(
  "release API HTTP %s is an error, not up-to-date",
  async (status) => {
    const { updater, responses } = await fixture();
    responses.set("/releases", { status, body: "" });
    await expect(updater.checkForUpdates()).rejects.toMatchObject({
      statusCode: status,
    });
  },
);

test("reads subsequent pages before choosing the highest semantic version", async () => {
  const { updater, responses } = await fixture();
  responses.set("/releases?per_page=100&page=1", {
    body: JSON.stringify(
      Array.from({ length: 100 }, () => release("0.4.0-beta.2")),
    ),
  });
  responses.set("/releases?per_page=100&page=2", {
    body: JSON.stringify([release("0.4.1-beta.2")]),
  });
  responses.set("/download/v0.4.1-beta.2/beta.yml", {
    body: metadata("0.4.1-beta.2"),
  });
  expect((await updater.checkForUpdates())?.isUpdateAvailable).toBe(true);
});

test("no compatible published releases remains an explicit error", async () => {
  const { updater, responses } = await fixture();
  responses.set("/releases", { body: "[]" });
  await expect(updater.checkForUpdates()).rejects.toMatchObject({
    code: "ERR_UPDATER_NO_PUBLISHED_VERSIONS",
  });
});

test.each(["not JSON", "{}", "[null]", '[{"tag_name":"v0.4.1-beta.2"}]'])(
  "malformed API data remains an explicit error: %s",
  async (body) => {
    const { updater, responses } = await fixture();
    responses.set("/releases", { body });
    await expect(updater.checkForUpdates()).rejects.toMatchObject({
      code: "ERR_UPDATER_INVALID_RELEASE_FEED",
    });
  },
);

test("an incomplete bounded scan never reports an old version as current", async () => {
  const { updater, responses, requests } = await fixture();
  responses.set("/releases", {
    body: JSON.stringify(
      Array.from({ length: 100 }, () => release("0.4.0-beta.2")),
    ),
  });
  await expect(updater.checkForUpdates()).rejects.toMatchObject({
    code: "ERR_UPDATER_RELEASE_LIST_LIMIT",
  });
  expect(requests).toHaveLength(10);
  expect(requests.some((url) => url.includes(".yml"))).toBe(false);
});
