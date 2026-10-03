import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AlbumHeader } from "../src/client/AlbumHeader";
import { DiscHeader } from "../src/client/DiscHeader";

describe("shared album presentation", () => {
  it("keeps the selectable content button separate from management and collapse buttons", () => {
    const html = renderToStaticMarkup(
      createElement(AlbumHeader, {
        title: "Album",
        role: "group",
        contentButton: { "aria-pressed": true },
        collapseControl: createElement("button", null, "Collapse"),
        actions: createElement("button", null, "Remove"),
      }),
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('class="track-album-copy track-album-main"');
    expect(html).toMatch(
      /<button[^>]*><small>[^]*<\/strong><\/button><div class="track-album-state"/,
    );
    expect(html).not.toContain('role="button"');
  });

  it("preserves catalog content, classes and forwarded selection attributes", () => {
    const html = renderToStaticMarkup(
      createElement(AlbumHeader, {
        title: "Album",
        artists: ["One", "Two"],
        year: 2024,
        genres: ["Rock"],
        coverId: "cover-id",
        duration: "42:00",
        selected: true,
        role: "button",
        "aria-pressed": true,
        actions: createElement("button", null, "Rate"),
      }),
    );
    expect(html).toContain('class="track-album-header selected"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("/api/covers/cover-id");
    expect(html).toContain("<small>One, Two</small>");
    expect(html).toContain("<strong>Album</strong>");
    expect(html).toContain("<small>2024 · Rock</small>");
    expect(html).toContain('class="track-album-actions"><button>Rate</button>');
    expect(html).toContain('class="track-album-duration">42:00</span>');
  });

  it("accepts generic content and optional collapse control without a panel mode", () => {
    const html = renderToStaticMarkup(
      createElement(AlbumHeader, {
        title: "Folder",
        subtitle: "Parent",
        details: "3 tracks",
        cover: createElement("span", null, "Folder icon"),
        collapseControl: createElement(
          "button",
          { "aria-expanded": true },
          "Collapse",
        ),
        className: "current",
      }),
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Folder icon");
    expect(html).toContain("<small>Parent</small>");
    expect(html).toContain("<small>3 tracks</small>");
    expect(html).toContain('class="track-album-copy"');
    expect(html).not.toContain("Неизвестный исполнитель");
  });

  it("retains unknown album fallbacks and disc presentation", () => {
    const html = renderToStaticMarkup(
      createElement(AlbumHeader, { title: "" }),
    );
    expect(html).toContain("Неизвестный исполнитель");
    expect(html).toContain("Без альбома");
    const disc = renderToStaticMarkup(
      createElement(DiscHeader, { discNumber: 2 }),
    );
    expect(disc).toContain('class="track-disc-header"');
    expect(disc).toContain('aria-hidden="true"');
    expect(disc).toContain("Диск 2");
  });
});
