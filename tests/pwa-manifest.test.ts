import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("PWA manifest", () => {
  it("declares standalone Harbor Player metadata and taskbar icon sizes", async () => {
    const manifest = JSON.parse(
      await readFile(
        path.join(projectRoot, "public", "manifest.webmanifest"),
        "utf8",
      ),
    );

    expect(manifest).toMatchObject({
      id: "/",
      name: "Harbor Player",
      short_name: "Harbor Player",
      lang: "ru",
      start_url: "/",
      scope: "/",
      display: "standalone",
      theme_color: "#171c21",
      background_color: "#171c21",
      icons: [
        {
          src: "/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
      ],
    });

    await expect(
      readFile(path.join(projectRoot, "index.html"), "utf8"),
    ).resolves.toContain('rel="manifest" href="/manifest.webmanifest"');
  });

  it("ships the declared PNG icon dimensions", async () => {
    await expect(
      sharp(path.join(projectRoot, "public", "icon-192.png")).metadata(),
    ).resolves.toMatchObject({ format: "png", width: 192, height: 192 });
    await expect(
      sharp(path.join(projectRoot, "public", "icon-512.png")).metadata(),
    ).resolves.toMatchObject({ format: "png", width: 512, height: 512 });
  });
});
