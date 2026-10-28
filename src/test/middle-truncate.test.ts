// Long names cut in the middle (2026-10 design review): siblings differ at their end
// ("…Volume 12", "…Volume 13"), and a cut at the end made them read the same.
import { render, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach } from "vitest";
import MiddleTruncate from "$lib/components/MiddleTruncate.svelte";
import { splitName, splitPath } from "$lib/utils/middle-truncate";

afterEach(cleanup);

describe("where a name is cut", () => {
  it("keeps the words that tell siblings apart", () => {
    expect(splitName("Annals of the Iron Hand, Volume 13")).toEqual({
      head: "Annals of the Iron Hand,",
      tail: " Volume 13",
    });
  });

  it("keeps one last word when it is long enough alone", () => {
    expect(splitName("The Ashfen Chronicle").tail).toBe(" Chronicle");
  });

  it("cuts a short name at its end, as before", () => {
    expect(splitName("Mira Ashvale")).toEqual({ head: "Mira Ashvale", tail: "" });
  });

  it("cuts at the end when the last word is too long to keep whole", () => {
    expect(splitName("Notes on Antidisestablishmentarianism").tail).toBe("");
  });

  it("keeps a path's last folder", () => {
    expect(splitPath("C:/Users/gm/Worlds/Gods Ascendant")).toEqual({
      head: "C:/Users/gm/Worlds",
      tail: "/Gods Ascendant",
    });
    expect(splitPath("D:\\Campaigns\\Phandelver").tail).toBe("\\Phandelver");
  });
});

describe("a name cut in the middle", () => {
  it("still reads as the whole name", () => {
    const { container } = render(MiddleTruncate, {
      props: { text: "Annals of the Iron Hand, Volume 13" },
    });
    expect(container.textContent).toBe("Annals of the Iron Hand, Volume 13");
  });

  it("is one span when there is nothing to keep", () => {
    const { container } = render(MiddleTruncate, { props: { text: "Mira Ashvale" } });
    expect(container.querySelectorAll("span")).toHaveLength(1);
  });
});
