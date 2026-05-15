import { describe, it, expect } from "vitest";
import { isImageFile, preprocessImageAttrs, serializeImageNode } from "$lib/editor/image-block";

function makeFile(name: string, type: string): File {
  return new File([], name, { type });
}

describe("isImageFile", () => {
  it.each([
    ["image/jpeg", "photo.jpg"],
    ["image/jpeg", "photo.jpeg"],
    ["image/png", "img.png"],
    ["image/gif", "anim.gif"],
    ["image/webp", "img.webp"],
  ])("accepts %s", (type, name) => {
    expect(isImageFile(makeFile(name, type))).toBe(true);
  });

  it.each([
    ["image/svg+xml", "icon.svg"],
    ["application/pdf", "doc.pdf"],
    ["audio/mp3", "track.mp3"],
    ["text/plain", "readme.txt"],
    ["", "noext"],
  ])("rejects %s", (type, name) => {
    expect(isImageFile(makeFile(name, type))).toBe(false);
  });
});

// ─── preprocessImageAttrs ────────────────────────────────────────────────────

describe("preprocessImageAttrs", () => {
  it("no attrs block — returns string unchanged", () => {
    const md = "![hello](images/portrait.png)";
    expect(preprocessImageAttrs(md)).toBe(md);
  });

  it("caption only — no attrs block, returns unchanged", () => {
    const md = "![portrait of the villain](images/villain.png)";
    expect(preprocessImageAttrs(md)).toBe(md);
  });

  it("align only", () => {
    expect(preprocessImageAttrs("![](images/a.png){align=left}")).toBe(
      `<img src="images/a.png" alt="" data-align="left" data-width="100%">`,
    );
  });

  it("width only", () => {
    expect(preprocessImageAttrs("![](images/a.png){width=60%}")).toBe(
      `<img src="images/a.png" alt="" data-align="center" data-width="60%">`,
    );
  });

  it("caption + align", () => {
    expect(preprocessImageAttrs("![portrait](images/a.png){align=right}")).toBe(
      `<img src="images/a.png" alt="portrait" data-align="right" data-width="100%">`,
    );
  });

  it("caption + width", () => {
    expect(preprocessImageAttrs("![portrait](images/a.png){width=50%}")).toBe(
      `<img src="images/a.png" alt="portrait" data-align="center" data-width="50%">`,
    );
  });

  it("caption + align + width", () => {
    expect(
      preprocessImageAttrs("![portrait](images/a.png){align=left width=75%}"),
    ).toBe(
      `<img src="images/a.png" alt="portrait" data-align="left" data-width="75%">`,
    );
  });

  it("caption with double-quotes is HTML-escaped", () => {
    expect(
      preprocessImageAttrs(`!["ancient" ruin](images/a.png){align=left}`),
    ).toBe(
      `<img src="images/a.png" alt="&quot;ancient&quot; ruin" data-align="left" data-width="100%">`,
    );
  });

  it("caption with unicode survives", () => {
    expect(
      preprocessImageAttrs("![人物の肖像](images/a.png){width=80%}"),
    ).toBe(
      `<img src="images/a.png" alt="人物の肖像" data-align="center" data-width="80%">`,
    );
  });

  it("caption with parens in alt text survives", () => {
    expect(
      preprocessImageAttrs("![café (portrait)](images/a.png){width=80%}"),
    ).toBe(
      `<img src="images/a.png" alt="café (portrait)" data-align="center" data-width="80%">`,
    );
  });
});

// ─── serializeImageNode ──────────────────────────────────────────────────────

type SerializeState = { write: (s: string) => void; closeBlock: (n: unknown) => void };

function makeState() {
  const written: string[] = [];
  const state: SerializeState & { written: string[] } = {
    written,
    write: (s: string) => written.push(s),
    closeBlock: () => {},
  };
  return state;
}

describe("serializeImageNode", () => {
  it("no attrs, no caption → ![](src)", () => {
    const s = makeState();
    serializeImageNode(s, { attrs: { src: "images/a.png", alt: null, align: "center", width: "100%" } });
    expect(s.written[0]).toBe("![](images/a.png)");
  });

  it("caption only → ![caption](src) (no attrs block)", () => {
    const s = makeState();
    serializeImageNode(s, { attrs: { src: "images/a.png", alt: "portrait", align: "center", width: "100%" } });
    expect(s.written[0]).toBe("![portrait](images/a.png)");
  });

  it("align only → ![](src){align=left}", () => {
    const s = makeState();
    serializeImageNode(s, { attrs: { src: "images/a.png", alt: null, align: "left", width: "100%" } });
    expect(s.written[0]).toBe("![](images/a.png){align=left}");
  });

  it("width only → ![](src){width=60%}", () => {
    const s = makeState();
    serializeImageNode(s, { attrs: { src: "images/a.png", alt: null, align: "center", width: "60%" } });
    expect(s.written[0]).toBe("![](images/a.png){width=60%}");
  });

  it("caption + align → ![caption](src){align=right}", () => {
    const s = makeState();
    serializeImageNode(s, { attrs: { src: "images/a.png", alt: "portrait", align: "right", width: "100%" } });
    expect(s.written[0]).toBe("![portrait](images/a.png){align=right}");
  });

  it("caption + width → ![caption](src){width=50%}", () => {
    const s = makeState();
    serializeImageNode(s, { attrs: { src: "images/a.png", alt: "portrait", align: "center", width: "50%" } });
    expect(s.written[0]).toBe("![portrait](images/a.png){width=50%}");
  });

  it("caption + align + width → ![caption](src){align=left width=75%}", () => {
    const s = makeState();
    serializeImageNode(s, { attrs: { src: "images/a.png", alt: "portrait", align: "left", width: "75%" } });
    expect(s.written[0]).toBe("![portrait](images/a.png){align=left width=75%}");
  });

  it("empty string alt treated same as null", () => {
    const s = makeState();
    serializeImageNode(s, { attrs: { src: "images/a.png", alt: "", align: "center", width: "100%" } });
    expect(s.written[0]).toBe("![](images/a.png)");
  });

  it("special chars in caption are preserved exactly", () => {
    const caption = 'café [brackets] (parens) "quotes"';
    const s = makeState();
    serializeImageNode(s, { attrs: { src: "images/a.png", alt: caption, align: "center", width: "100%" } });
    expect(s.written[0]).toBe(`![${caption}](images/a.png)`);
  });

  it("unicode caption survives", () => {
    const s = makeState();
    serializeImageNode(s, { attrs: { src: "images/a.png", alt: "人物の肖像", align: "left", width: "60%" } });
    expect(s.written[0]).toBe("![人物の肖像](images/a.png){align=left width=60%}");
  });
});

// ─── markdown round-trip ──────────────────────────────────────────────────────

describe("markdown round-trip (serialize → preprocess)", () => {
  function roundTrip(attrs: { src: string; alt: string | null; align: string; width: string }): string {
    const s = makeState();
    serializeImageNode(s, { attrs });
    return preprocessImageAttrs(s.written[0]);
  }

  it("caption + align + width", () => {
    expect(roundTrip({ src: "images/a.png", alt: "portrait", align: "left", width: "75%" })).toBe(
      '<img src="images/a.png" alt="portrait" data-align="left" data-width="75%">',
    );
  });

  it("align only", () => {
    expect(roundTrip({ src: "images/a.png", alt: null, align: "right", width: "100%" })).toBe(
      '<img src="images/a.png" alt="" data-align="right" data-width="100%">',
    );
  });

  it("caption only — preprocessor is a no-op (no attrs block)", () => {
    expect(roundTrip({ src: "images/a.png", alt: "portrait", align: "center", width: "100%" })).toBe(
      "![portrait](images/a.png)",
    );
  });

  it("no attrs, no caption — preprocessor is a no-op", () => {
    expect(roundTrip({ src: "images/a.png", alt: null, align: "center", width: "100%" })).toBe(
      "![](images/a.png)",
    );
  });

  it("unicode caption + align", () => {
    expect(roundTrip({ src: "images/a.png", alt: "人物の肖像", align: "left", width: "60%" })).toBe(
      '<img src="images/a.png" alt="人物の肖像" data-align="left" data-width="60%">',
    );
  });
});
