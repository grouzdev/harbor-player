import type { AppUpdater, UpdateInfo } from "electron-updater";
import {
  Provider,
  parseUpdateInfo,
  resolveFiles,
  type ProviderRuntimeOptions,
} from "electron-updater/out/providers/Provider.js";
import { gt, valid } from "semver";

const repository = "grouzdev/harbor-player";

type Release = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: { name: string; state: string }[];
};

function failure(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

// electron-updater 6.8.9's GitHubProvider reads an Atom feed containing bare
// tags, including failed releases. Keep its download/install machinery, but
// discover versions only through the published Releases API.
export class PublishedReleaseProvider extends Provider<UpdateInfo> {
  protected apiBase = `https://api.github.com/repos/${repository}/releases`;
  protected downloadBase = `https://github.com/${repository}/releases/download/`;
  private releaseBase?: URL;

  constructor(
    _options: unknown,
    private readonly updater: AppUpdater,
    runtime: ProviderRuntimeOptions,
  ) {
    super({ ...runtime, isUseMultipleRangeRequest: false });
  }

  async getLatestVersion(): Promise<UpdateInfo> {
    const channel = this.updater.channel;
    if (channel !== "beta" && channel !== "latest")
      throw failure(
        "ERR_UPDATER_INVALID_CHANNEL",
        "Unsupported update channel",
      );
    let selected: Release | undefined;
    // Scan pages because publication order need not match semantic versions.
    // A bounded incomplete scan fails explicitly rather than offering an old
    // version as the latest. No credentials or environment tokens are used.
    for (let page = 1; ; page++) {
      if (page > 10)
        throw failure(
          "ERR_UPDATER_RELEASE_LIST_LIMIT",
          "Release list is too large",
        );
      const raw = await this.httpRequest(
        new URL(`${this.apiBase}?per_page=100&page=${page}`),
        { Accept: "application/vnd.github+json" },
      );
      let releases: unknown;
      try {
        releases = JSON.parse(raw ?? "null");
      } catch {
        throw failure(
          "ERR_UPDATER_INVALID_RELEASE_FEED",
          "Invalid published release JSON",
        );
      }
      if (!Array.isArray(releases))
        throw failure(
          "ERR_UPDATER_INVALID_RELEASE_FEED",
          "Invalid published release list",
        );
      for (const item of releases) {
        if (
          !item ||
          typeof item !== "object" ||
          typeof item.tag_name !== "string" ||
          typeof item.draft !== "boolean" ||
          typeof item.prerelease !== "boolean" ||
          !(item.published_at === null || typeof item.published_at === "string")
        )
          throw failure(
            "ERR_UPDATER_INVALID_RELEASE_FEED",
            "Invalid published release entry",
          );
        const release = item as Release;
        if (release.draft || !release.published_at) continue;
        const version = release.tag_name.replace(/^v/, "");
        const matchesChannel =
          channel === "beta"
            ? /^\d+\.\d+\.\d+-beta\.\d+$/.test(version) && release.prerelease
            : /^\d+\.\d+\.\d+$/.test(version) && !release.prerelease;
        if (!matchesChannel || !valid(version)) continue;
        if (!selected || gt(version, selected.tag_name.replace(/^v/, "")))
          selected = release;
      }
      if (releases.length < 100) break;
    }
    if (!selected)
      throw failure(
        "ERR_UPDATER_NO_PUBLISHED_VERSIONS",
        "No published releases for this channel",
      );
    const file = `${channel}.yml`;
    this.releaseBase = new URL(
      `${encodeURIComponent(selected.tag_name)}/`,
      this.downloadBase,
    );
    const metadataUrl = new URL(file, this.releaseBase);
    if (
      !Array.isArray(selected.assets) ||
      !selected.assets.some(
        (asset) => asset?.name === file && asset.state === "uploaded",
      )
    )
      throw failure(
        "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
        `Published release metadata not found: ${metadataUrl}`,
      );
    // Deliberately no latest.yml fallback: a 404, corrupt metadata or an outage
    // on a published release must remain a failed check.
    let raw: string | null;
    try {
      raw = await this.httpRequest(metadataUrl);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "statusCode" in error &&
        error.statusCode === 404
      )
        throw Object.assign(
          failure(
            "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
            `Published release metadata not found: ${metadataUrl}`,
          ),
          { statusCode: 404 },
        );
      throw error;
    }
    const info = parseUpdateInfo(raw, file, metadataUrl);
    if (info.version !== selected.tag_name.replace(/^v/, ""))
      throw failure(
        "ERR_UPDATER_INVALID_UPDATE_INFO",
        "Release tag and metadata version disagree",
      );
    return info;
  }

  resolveFiles(info: UpdateInfo) {
    if (!this.releaseBase)
      throw failure(
        "ERR_UPDATER_INVALID_UPDATE_INFO",
        "No selected published release",
      );
    return resolveFiles(info, this.releaseBase);
  }
}
