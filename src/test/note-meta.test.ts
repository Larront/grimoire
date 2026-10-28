import { describe, it, expect } from "vitest";
import { formatFolder, formatRelativeTime } from "$lib/utils/note-meta";

describe("formatFolder", () => {
  it("says a note at the top of the world is at the top level, not in its own file", () => {
    expect(formatFolder("Morrigan.md")).toBe("Top level");
  });

  it("names the folders, and only the folders", () => {
    expect(formatFolder("NPCs/Morrigan.md")).toBe("NPCs");
    expect(formatFolder("NPCs/Westmarch/Morrigan.md")).toBe("NPCs / Westmarch");
    expect(formatFolder("A/B/C/Morrigan.md")).toBe("A / B / C");
  });

  it("shortens a long trail in the middle, keeping where it starts and ends", () => {
    expect(formatFolder("World/Locations/Cities/Westmarch/NPCs/Morrigan.md")).toBe(
      "World / … / Westmarch / NPCs",
    );
  });
});

describe("formatRelativeTime", () => {
  const at = (iso: string) => new Date(iso);
  const now = at("2026-01-15T12:00:00Z");

  it("under 60 seconds → just now", () => {
    expect(formatRelativeTime("2026-01-15T11:59:30Z", now)).toBe("just now");
  });

  it("exactly 60 seconds → 1 minute ago", () => {
    expect(formatRelativeTime("2026-01-15T11:59:00Z", now)).toBe("1 minute ago");
  });

  it("3 minutes ago", () => {
    expect(formatRelativeTime("2026-01-15T11:57:00Z", now)).toBe("3 minutes ago");
  });

  it("1 hour ago (singular)", () => {
    expect(formatRelativeTime("2026-01-15T11:00:00Z", now)).toBe("1 hour ago");
  });

  it("2 hours ago", () => {
    expect(formatRelativeTime("2026-01-15T10:00:00Z", now)).toBe("2 hours ago");
  });

  it("1 day ago (singular)", () => {
    expect(formatRelativeTime("2026-01-14T12:00:00Z", now)).toBe("1 day ago");
  });

  it("2 days ago", () => {
    expect(formatRelativeTime("2026-01-13T12:00:00Z", now)).toBe("2 days ago");
  });

  it("last week (7 days)", () => {
    expect(formatRelativeTime("2026-01-08T12:00:00Z", now)).toBe("last week");
  });

  it("last week (13 days)", () => {
    expect(formatRelativeTime("2026-01-02T12:00:00Z", now)).toBe("last week");
  });

  it("2 weeks ago (14 days)", () => {
    expect(formatRelativeTime("2026-01-01T12:00:00Z", now)).toBe("2 weeks ago");
  });

  it("last month (~30 days)", () => {
    const then = new Date(now);
    then.setDate(then.getDate() - 30);
    expect(formatRelativeTime(then.toISOString(), now)).toBe("last month");
  });

  it("2 months ago (~60 days)", () => {
    const then = new Date(now);
    then.setDate(then.getDate() - 60);
    expect(formatRelativeTime(then.toISOString(), now)).toBe("2 months ago");
  });
});
