import { describe, it, expect } from "vitest";
import { isImageFile } from "$lib/editor/image-block";

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
