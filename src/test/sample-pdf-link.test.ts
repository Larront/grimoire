// The sample world's seeded PDF Scene-link must land on the words it claims.
//
// `SAMPLE_PDF_LINK` in `src-tauri/src/commands/sample.rs` is a page, a character range
// and a quote. Nothing in Rust reads PDFs, so the Rust integrity test can only check the
// link points at a real file and scene; whether offsets 1688–1704 on page 1 still say
// "Running the Hunt" is a question about the PDF's text, answered here with PDF.js —
// indexed exactly as the viewer's find and the link layer index it (text items,
// concatenated). An edited PDF or a mistyped offset fails here, rather than the sample
// greeting a first-time GM with a link marked "the text here has changed".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const source = readFileSync("src-tauri/src/commands/sample.rs", "utf8");
const block = /pub const SAMPLE_PDF_LINK: SamplePdfLink = SamplePdfLink \{([\s\S]*?)\};/.exec(
  source,
)?.[1];

function field(name: string): string {
  const m = new RegExp(`${name}:\\s*(?:"([^"]*)"|(\\d+))`).exec(block ?? "");
  if (!m) throw new Error(`SAMPLE_PDF_LINK.${name} not found in sample.rs`);
  return m[1] ?? m[2];
}

describe("the sample PDF's seeded Scene-link", () => {
  it("is declared in sample.rs", () => {
    expect(block).toBeTruthy();
  });

  it("spans its quote in the bundled PDF, as the viewer indexes the page", async () => {
    const pdfPath = field("pdf_path");
    const page = Number(field("page"));
    const start = Number(field("start_offset"));
    const end = Number(field("end_offset"));
    const quote = field("quote");

    const data = new Uint8Array(readFileSync(`src-tauri/sample-world/${pdfPath}`));
    const doc = await getDocument({ data }).promise;
    const content = await (await doc.getPage(page)).getTextContent();
    const text = content.items
      .filter((it) => "str" in it)
      .map((it) => (it as { str: string }).str)
      .join("");

    expect(text.slice(start, end)).toBe(quote);
  }, 20000);
});
