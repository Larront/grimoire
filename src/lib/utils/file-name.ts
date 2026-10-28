// Names a GM types that become file or folder names: what they may be, and how
// a list of them is ordered.
//
// `nameProblem` says as the GM types what `check_file_name`
// (`src-tauri/src/commands/names.rs`) would refuse, so a field can show the
// reason under itself instead of a toast after the fact. Windows' rules, because
// a world may be synced between platforms.

/** What is wrong with a name for a file or folder, or null when it will do. */
export function nameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give it a name.";
  if (/[/\\:*?"<>|]/.test(trimmed)) return "A name can't contain / \\ : * ? \" < > |";
  if (trimmed === "." || trimmed === "..") return "That name isn't allowed.";
  if (trimmed.endsWith(".")) return "A name can't end with a full stop.";
  return null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Names in the order a person reads them: "Annal 2" before "Annal 10", and case
 * ignored, so "bandit camp" sits among the Bs rather than after every capital.
 */
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b);
}
