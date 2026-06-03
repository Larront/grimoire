/** Exposed so location pickers can clear exactly this error once a location is chosen. */
export const MISSING_LOCATION_ERROR = "Please choose a storage location.";

/**
 * Validates a new-ledger name + parent location (shared by the Splash
 * "creating" form and the sample-adopt dialog). Returns an error message,
 * or null when valid.
 */
export function validateLedgerName(
  name: string,
  parent: string | null,
): string | null {
  const trimmed = name.trim();

  if (!trimmed) {
    return "Please enter a ledger name.";
  }
  if (/[/\\:*?"<>|]/.test(trimmed)) {
    return 'Name contains invalid characters ( / \\ : * ? " < > | ).';
  }
  if (trimmed === "." || trimmed === "..") {
    return "Invalid ledger name.";
  }
  if (!parent) {
    return MISSING_LOCATION_ERROR;
  }

  return null;
}
