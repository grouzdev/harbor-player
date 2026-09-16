import type { TagPatch } from "./contracts.js";

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string; percent: number }
  | { status: "downloaded"; version: string }
  | { status: "preparingInstall"; version: string }
  | { status: "upToDate" }
  | { status: "unsupported" }
  | { status: "error"; message: string };

export type BackendToMainMessage =
  | { type: "ready"; url: string }
  | { type: "fatal"; error: string }
  | { type: "stopped" }
  | {
      type: "tag-write";
      requestId: string;
      file: string;
      patch: TagPatch;
    };

export type MainToBackendMessage =
  | { type: "stop" }
  | {
      type: "tag-write-result";
      requestId: string;
      ok: boolean;
      error?: string;
    };

export type MainToTagWriterMessage = {
  type: "write-tags";
  requestId: string;
  file: string;
  patch: TagPatch;
};

export type TagWriterToMainMessage = {
  type: "tag-write-result";
  requestId: string;
  ok: boolean;
  error?: string;
};
