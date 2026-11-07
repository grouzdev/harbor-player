import { useEffect, useRef } from "react";
import { api } from "./api";
import {
  normalizeWorkspaceSession,
  type WorkspaceSession,
} from "../shared/workspace-session";

let session: WorkspaceSession = { version: 1 };
let writable = false;
let lastSaved = "";
let chain = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | undefined;
let reported = false;
const collectors = new Map<string, () => void>();

declare global {
  interface Window {
    harborPlayerFlushSession?: () => Promise<void>;
  }
}

function report() {
  if (reported) return;
  reported = true;
  window.dispatchEvent(new CustomEvent("harbor-session-error"));
}

export async function loadWorkspaceSession() {
  try {
    session = normalizeWorkspaceSession(
      await api("/workspace-session", undefined, "GET", {
        signal: AbortSignal.timeout(5000),
      }),
    );
    lastSaved = JSON.stringify(session);
    writable = true;
  } catch {
    // Do not overwrite a session we could not read with startup defaults.
    writable = false;
  }
}

export function readSession<K extends keyof WorkspaceSession>(
  key: K,
): WorkspaceSession[K] {
  return session[key];
}

export function writeSession<K extends keyof WorkspaceSession>(
  key: K,
  value: WorkspaceSession[K],
) {
  session = { ...session, [key]: value };
  scheduleSessionSave();
}

export function scheduleSessionSave() {
  clearTimeout(timer);
  timer = setTimeout(() => void flushWorkspaceSession().catch(report), 300);
}

export function flushWorkspaceSession(): Promise<void> {
  clearTimeout(timer);
  for (const collect of collectors.values()) collect();
  clearTimeout(timer);
  if (!writable) return Promise.reject(new Error("Сессия не загружена"));
  const body = JSON.stringify(session);
  chain = chain
    .catch(() => {})
    .then(async () => {
      if (body === lastSaved) return;
      await api("/workspace-session", JSON.parse(body), "POST", {
        keepalive: new TextEncoder().encode(body).length < 60000,
      });
      lastSaved = body;
      reported = false;
    });
  return chain;
}

// Read the latest committed render, and keep the last section when its view
// unmounts. No persistence of modal state, query caches, or in-flight actions.
export function useSessionWriter<K extends keyof WorkspaceSession>(
  key: K,
  collect: () => WorkspaceSession[K],
) {
  const latest = useRef(collect);
  useEffect(() => {
    latest.current = collect;
    scheduleSessionSave();
  });
  useEffect(() => {
    const save = () => {
      session = { ...session, [key]: latest.current() };
    };
    collectors.set(key, save);
    return () => {
      save();
      collectors.delete(key);
      scheduleSessionSave();
    };
  }, [key]);
}

export function installSessionPersistence() {
  window.harborPlayerFlushSession = flushWorkspaceSession;
  window.addEventListener(
    "scroll",
    () => {
      // Capture while the panel is still visible, even if the next click switches
      // modes before the debounced disk write.
      collectors.get("catalog")?.();
      scheduleSessionSave();
    },
    true,
  );
  window.addEventListener(
    "pagehide",
    () => void flushWorkspaceSession().catch(report),
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden")
      void flushWorkspaceSession().catch(report);
  });
  // Also checkpoints playback time while the renderer is visible.
  setInterval(() => void flushWorkspaceSession().catch(report), 3000);
}
