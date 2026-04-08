import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any }
  ? Omit<T, "children">
  : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
  ref?: U | null;
};

function parseTagsBlock(block: string): string[] {
  // Inline form: tags: [a, b, c]
  const inline = block.match(/^tags:\s*\[([^\]]*)\]/m);
  if (inline) {
    return inline[1]
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  // Block form:
  // tags:
  //   - a
  //   - b
  const blockMatch = block.match(/^tags:\s*\n((?:[ \t]*-[ \t]+[^\n]*\n?)*)/m);
  if (blockMatch) {
    return blockMatch[1]
      .split("\n")
      .map((l) => l.replace(/^[ \t]*-[ \t]+/, "").trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Strips the leading YAML frontmatter block (if any) and extracts tags.
 * Returns the body (everything after the closing ---) and the tags array.
 */
export function parseFrontmatter(raw: string): {
  tags: string[];
  body: string;
} {
  if (!raw.startsWith("---\n")) return { tags: [], body: raw };
  const closeIdx = raw.indexOf("\n---", 4);
  if (closeIdx === -1) return { tags: [], body: raw };
  const block = raw.slice(4, closeIdx);
  const afterClose = raw.slice(closeIdx + 4); // after \n---
  const body = afterClose.startsWith("\n") ? afterClose.slice(1) : afterClose;
  return { tags: parseTagsBlock(block), body };
}

/**
 * Prepends a YAML frontmatter block to body if tags is non-empty.
 * If tags is empty, returns body unchanged (no frontmatter block written).
 */
export function serializeFrontmatter(tags: string[], body: string): string {
  if (tags.length === 0) return body;
  return `---\ntags: [${tags.join(", ")}]\n---\n${body}`;
}
