// A new ledger's name and where it goes — shared by the Splash's create form and the
// Adopt dialog through `NewLedgerFields`, so both say the same things in the same words.

/** What is wrong with a name for a new world's folder, or null when it will do. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give it a name.";
  if (/[/\\:*?"<>|]/.test(trimmed)) return "A name can't contain / \\ : * ? \" < > |";
  if (trimmed === "." || trimmed === "..") return "That name isn't allowed.";
  return null;
}

/** Said under Location when nothing has been chosen. */
export const NO_LOCATION = "Choose where to save it.";

/** Whether the form can go ahead: a usable name and a chosen folder. */
export function fieldsReady(name: string, parent: string | null): parent is string {
  return nameProblem(name) === null && !!parent;
}

/** The folder a new world becomes: `name` inside `parent`, in `parent`'s own separator. */
export function ledgerDestination(parent: string, name: string): string {
  const sep = parent.includes("\\") ? "\\" : "/";
  return parent.replace(/[\\/]+$/, "") + sep + name.trim();
}

/**
 * A path short enough for one line, keeping its *end* — the folder the GM chose and
 * the one being made are what matter, and a tail-truncated path hid exactly those.
 * The full path goes in a `title` beside it.
 */
export function shortPath(path: string): string {
  const sep = path.includes("\\") ? "\\" : "/";
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return path;
  return ["…", ...parts.slice(-2)].join(sep);
}
