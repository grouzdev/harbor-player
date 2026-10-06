import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
} from "node:fs";
import path from "node:path";

// Never retain arbitrary updater messages: URLs, headers, paths and response
// bodies can contain credentials or private data. Keep only an allowlisted code.
export function safeUpdateCode(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  return /^(?:ERR_UPDATER_[A-Z_]+|E(?:CONNRESET|CONNREFUSED|TIMEDOUT|NETUNREACH|ACCES|NOSPC)|ENOTFOUND)$/.test(
    code,
  )
    ? code
    : "UNKNOWN";
}

export function safeUpdateDiagnostics(error: unknown): string {
  const input =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const message = typeof input.message === "string" ? input.message : "";
  const statusValue = input.statusCode ?? input.status;
  const status =
    typeof statusValue === "number" && statusValue >= 100 && statusValue <= 599
      ? statusValue
      : Number(
          message.match(
            /\b(?:HttpError|HTTP(?: error)?|status(?: code)?)[ :]+([1-5]\d\d)\b/i,
          )?.[1],
        ) || undefined;
  // Extract only known public service hosts, never userinfo, paths or queries.
  const hosts = new Set<string>();
  const metadata = new Set<string>();
  for (const candidate of message.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
    try {
      const url = new URL(candidate[0].replace(/[)\]},;:]+$/, ""));
      const host = url.hostname;
      if (
        [
          "github.com",
          "api.github.com",
          "objects.githubusercontent.com",
          "release-assets.githubusercontent.com",
        ].includes(host)
      )
        hosts.add(host);
      const match =
        host === "github.com" &&
        url.pathname.match(
          /^\/grouzdev\/harbor-player\/releases\/download\/(v?\d+\.\d+\.\d+(?:-(?:beta|alpha|rc)\.\d+)?)\/((?:latest|beta)(?:-mac|-linux)?\.yml)$/,
        );
      if (match) metadata.add(`${match[1]}/${match[2]}`);
    } catch {
      /* Malformed URLs carry no useful safe diagnostic. */
    }
  }
  const reason = /checksum|sha512|sha256/i.test(message)
    ? "checksum"
    : /signature|publisher/i.test(message)
      ? "signature"
      : /certificate|tls|ssl/i.test(message)
        ? "tls"
        : /timed? ?out|timeout/i.test(message)
          ? "timeout"
          : /ENOTFOUND|resolve|dns/i.test(message)
            ? "dns"
            : status === 404 || /404|not found/i.test(message)
              ? "not-found"
              : status === 401 ||
                  status === 403 ||
                  /401|403|forbidden|unauthorized/i.test(message)
                ? "access-denied"
                : /network|ECONN|socket/i.test(message)
                  ? "network"
                  : "unknown";
  return `reason=${reason}${status ? ` http=${status}` : ""}${hosts.size ? ` hosts=${[...hosts].join(",")}` : ""}${metadata.size ? ` metadata=${[...metadata].join(",")}` : ""}`;
}

export function createUpdateLog(
  directory: string,
  channel = "unknown",
  currentVersion = "",
) {
  const file = path.join(directory, "updater.log");
  return {
    file,
    write(event: string, operation: number, error?: unknown, version?: string) {
      try {
        mkdirSync(directory, { recursive: true });
        if (existsSync(file) && statSync(file).size >= 256 * 1024)
          renameSync(file, `${file}.1`);
        appendFileSync(
          file,
          `${new Date().toISOString()} operation=${operation} event=${event} channel=${/^(beta|latest)$/.test(channel) ? channel : "unknown"}${/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(currentVersion) ? ` currentVersion=${currentVersion}` : ""}${version && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version) ? ` version=${version}` : ""} code=${safeUpdateCode(error)} ${safeUpdateDiagnostics(error)}\n`,
          { mode: 0o600 },
        );
      } catch {
        // Diagnostics must never break the updater or expose filesystem errors.
      }
    },
  };
}
