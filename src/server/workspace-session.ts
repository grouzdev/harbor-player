import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  normalizeWorkspaceSession,
  workspaceSessionSchema,
} from "../shared/workspace-session.js";

// Small snapshots, serialized synchronously so neither shutdown nor concurrent
// requests can leave a partial file or let an older rename win.
export function workspaceSessionStore(directory: string) {
  const file = path.join(directory, "workspace-session.json");
  return {
    get() {
      try {
        return normalizeWorkspaceSession(
          JSON.parse(readFileSync(file, "utf8")),
        );
      } catch {
        return { version: 1 as const };
      }
    },
    set(value: unknown) {
      const session = workspaceSessionSchema.parse(value);
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(session), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
      return session;
    },
  };
}
