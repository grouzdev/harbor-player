import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";
export type { Page } from "@playwright/test";

// Optional stress mode for timing-sensitive browser workflows. This slows the
// renderer, not assertions or network replies, and never enables retries.
export const test = base.extend<{ cpuStress: void }>({
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
