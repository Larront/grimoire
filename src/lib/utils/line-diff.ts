// Which lines two versions of a note share and where they differ — for the conflict
// banner's Compare, so a GM choosing between their edit and another program's sees
// what each would keep (2026-10 design review; they used to choose blind).

export type DiffLine =
  | { kind: "same"; text: string }
  | { kind: "mine"; text: string }
  | { kind: "theirs"; text: string };

/** One run of differing lines, with a line of what surrounds it on each side. */
export type DiffHunk = DiffLine[];

/**
 * Line by line, by longest common subsequence. The shared start and end are taken
 * off first, so the table is only as large as the part that differs — an edit to one
 * paragraph of a long note costs that paragraph.
 */
export function diffLines(mine: string, theirs: string): DiffLine[] {
  const a = mine.split("\n");
  const b = theirs.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  // lcs[i][j]: length of the common subsequence of midA[i..] and midB[j..].
  const lcs: number[][] = Array.from({ length: midA.length + 1 }, () =>
    new Array<number>(midB.length + 1).fill(0),
  );
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      lcs[i][j] =
        midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = a.slice(0, start).map((text) => ({ kind: "same", text }));
  let i = 0;
  let j = 0;
  while (i < midA.length || j < midB.length) {
    if (i < midA.length && j < midB.length && midA[i] === midB[j]) {
      out.push({ kind: "same", text: midA[i] });
      i++;
      j++;
    } else if (j < midB.length && (i === midA.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      out.push({ kind: "theirs", text: midB[j] });
      j++;
    } else {
      out.push({ kind: "mine", text: midA[i] });
      i++;
    }
  }
  for (const text of a.slice(endA)) out.push({ kind: "same", text });
  return out;
}

/** The differing runs, each with up to `context` shared lines either side. */
export function diffHunks(lines: DiffLine[], context = 1): DiffHunk[] {
  const changed = lines.map((l) => l.kind !== "same");
  const keep = lines.map((_, i) => {
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) {
      if (changed[k]) return true;
    }
    return false;
  });
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  lines.forEach((line, i) => {
    if (keep[i]) {
      current ??= [];
      current.push(line);
    } else if (current) {
      hunks.push(current);
      current = null;
    }
  });
  if (current) hunks.push(current);
  return hunks;
}
