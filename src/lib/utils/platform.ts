// The GM's own platform, for the few words and keys that differ by OS.

export const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

const isWindows = typeof navigator !== "undefined" && /win/i.test(navigator.platform);

/** Where a deleted file goes, by the name the GM's OS gives it. */
export const recycleBin = isWindows ? "Recycle Bin" : "Trash";
