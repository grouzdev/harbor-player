import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";
export type { Page, Locator } from "@playwright/test";

// Optional stress mode for timing-sensitive browser workflows. This slows the
// renderer, not assertions or network replies, and never enables retries.
export const test = base.extend<{
  freshWorkspaceSession: void;
  cpuStress: void;
}>({
  // A new browser context no longer means a new application session. Isolate
  // independent tests, but preserve state across reloads/windows within a test.
  freshWorkspaceSession: [
    async ({ request }, use) => {
      const session = await (await request.get("/api/session")).json();
      const reset = await request.post("/api/workspace-session", {
        headers: { "X-CSRF-Token": session.csrf },
        data: { version: 1 },
      });
      if (!reset.ok()) throw new Error(`Session reset: ${reset.status()}`);
      await use();
    },
    { auto: true },
  ],
  cpuStress: [
    async ({ page }, use) => {
      const rate = Number(process.env.HARBOR_PLAYER_E2E_CPU_RATE || "1");
      if (!Number.isFinite(rate) || rate < 1)
        throw new Error("HARBOR_PLAYER_E2E_CPU_RATE must be a number >= 1");
      if (rate === 1) return use();
      const session = await page.context().newCDPSession(page);
      await session.send("Emulation.setCPUThrottlingRate", { rate });
      try {
        await use();
      } finally {
        await session.detach();
      }
    },
    { auto: true },
  ],
});
