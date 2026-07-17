import { toast } from "svelte-sonner";

// Errors auto-expire like every other toast: the tool must never pin a
// permanent surface to the corner during live play (DESIGN.md — "the tool
// disappears"). Longer than success — error copy is denser and higher-stakes —
// but still finite.
//
// The one sanctioned exception is `toastExternalMoveLinks` below: a
// Conflict-Banner-class response to an unresolved *external* change, which stays
// until the GM acts (ADR-0014). That narrowing does not license permanent
// tool-generated toasts — everything the app itself does still auto-expires.
const ERROR_DURATION = 8000;
// A partial-import failure carries a required "Show details" follow-up, so it
// lingers longer than a plain error to give the action time to be used.
const IMPORT_FAILURE_DURATION = 10000;

export function toastError(message: string) {
  // `id: message` dedupes identical errors: a repeating failure replaces its
  // predecessor and resets the timer instead of stacking permanent copies.
  toast.error(message, {
    id: message,
    duration: ERROR_DURATION,
    closeButton: true,
  });
}

export function toastSuccess(message: string) {
  toast.success(message, { duration: 3000 });
}

export function toastImportFailures(
  failures: { path: string; reason: string }[],
  onShowDetails: () => void,
) {
  if (failures.length === 0) return;
  const n = failures.length;
  // A failed import is a failure — render it with the error icon/colour like
  // every other failure, not as a neutral notice that fades before it's read.
  toast.error(`Couldn't import ${n} file${n === 1 ? "" : "s"}`, {
    id: "import-failures",
    duration: IMPORT_FAILURE_DURATION,
    closeButton: true,
    action: {
      label: "Show details",
      onClick: onShowDetails,
    },
  });
}

/**
 * Prompt to heal inbound backlinks after a note was moved/renamed *outside*
 * Grimoire (issue #135). Unlike every other toast this one is **persistent**
 * (`duration: Infinity`) and never auto-dismisses: it is a Conflict-Banner-class
 * response to an unresolved external change, not tool-generated corner-noise,
 * and ignoring it is non-destructive — the broken backlinks simply stay visible
 * and recoverable (ADR-0014). It rewrites nothing without consent: *Update* runs
 * `onUpdate`; *Leave as-is* just dismisses.
 */
export function toastExternalMoveLinks(
  oldName: string,
  count: number,
  onUpdate: () => void,
) {
  toast(
    `'${oldName}' moved externally. Update ${count} backlink${count === 1 ? "" : "s"}?`,
    {
      duration: Infinity,
      action: { label: "Update", onClick: onUpdate },
      // Clicking cancel dismisses the toast; there is no backend call — leaving
      // the backlinks as they are on disk is a safe, non-destructive choice.
      cancel: { label: "Leave as-is", onClick: () => {} },
    },
  );
}

/** Show an undo toast. `onConfirm` is called after the toast duration if the user does not click Undo. */
export function toastUndo(
  message: string,
  onConfirm: () => void,
  duration = 5000,
) {
  const timerId = setTimeout(onConfirm, duration);

  toast(message, {
    duration,
    action: {
      label: "Undo",
      onClick: () => clearTimeout(timerId),
    },
  });
}
