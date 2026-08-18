import { toast } from "svelte-sonner";
import MigrationReportBody from "$lib/components/toasts/MigrationReportBody.svelte";

// Errors auto-expire like every other toast: the tool must never pin a
// permanent surface to the corner during live play (DESIGN.md — "the tool
// disappears"). Longer than success — error copy is denser and higher-stakes —
// but still finite.
//
// Two sanctioned exceptions, both Conflict-Banner-class: a state that outlives
// the session, that the GM has to act on, and that is non-destructive to ignore.
// `toastExternalMoveLinks` is an unresolved *external* change (ADR-0014);
// `toastMigrationReport`'s failure branch is notes a [[Format Migration]] left on
// a format nothing reads (#184). Neither licenses permanent toasts for work the
// app has finished — that still auto-expires, including a migration that swept
// the whole vault cleanly.
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

/**
 * What a completed [[Format Migration]] leaves on screen (#184).
 *
 * The report is the record — a markdown file beside the backup, which outlives
 * the session — so this only **points at it**. A clean sweep is news rather than
 * an unresolved state, so it fades like everything else.
 *
 * **A partial failure is the second sanctioned permanent toast**, alongside
 * `toastExternalMoveLinks` above. ADR-0014's rule was "a persistent toast is for
 * an unresolved *external* change", and this one is Grimoire's own doing, so the
 * rule as written does not cover it — #184 widens it on the property that
 * actually earned the exception: notes are left on a format nothing reads, the
 * state outlives the session, and ignoring it is non-destructive. It is not
 * corner-noise about something the app already finished.
 *
 * Nothing at all when nothing was rewritten: the plan is recomputed at migrate
 * time, so a vault whose work vanished in between just opens.
 */
export function toastMigrationReport(report: {
  migrated: string[];
  failed: { path: string; reason: string }[];
  report_path: string;
}) {
  const done = report.migrated.length;
  const failed = report.failed.length;
  if (done === 0 && failed === 0) return;

  // The report is a place on disk, so both descriptions render it as a link that
  // reveals the file rather than as a path the GM has to read and retype. See
  // MigrationReportBody for why revealing beats opening.
  const body = (prose: string) => ({
    description: MigrationReportBody,
    componentProps: {
      prose,
      reportPath: report.report_path,
      // Passed in rather than imported by the component, which would make
      // toast.ts and the component import each other.
      onError: () => toastError("Couldn't show the report — it may have moved"),
    },
  });

  if (failed > 0) {
    toast.error(
      `${failed} note${failed === 1 ? "" : "s"} couldn't be updated`,
      {
        id: "format-migration",
        duration: Infinity,
        closeButton: true,
        ...body(
          `${done} of ${done + failed} were updated. The rest are still in the old format — the report lists them:`,
        ),
      },
    );
    return;
  }

  toast(`${done} note${done === 1 ? "" : "s"} updated`, {
    id: "format-migration",
    duration: ERROR_DURATION,
    closeButton: true,
    ...body(
      "Copies of them from before the change, and a report of what changed, are here:",
    ),
  });
}

/**
 * What a ledger repair that re-created notes leaves on screen (#224).
 *
 * Opening a vault brings the ledger's bookkeeping back into agreement with the
 * files on disk. Almost always it finds nothing to do. When it does act — after a
 * crash mid-operation, or a folder reorganised outside Grimoire — the notes come
 * through untouched, but pins the GM placed on their maps lose hold of them and
 * stop opening anything. Nothing else in the app connects that symptom to its
 * cause, so this is the only place the GM can learn it happened.
 *
 * **The third sanctioned permanent toast**, on the terms `toastMigrationReport`
 * set: the state outlives the session (a pin stays unlinked until someone
 * re-links it), the GM is the only one who can resolve it, and ignoring it is
 * non-destructive. It is also why *Show pins* is not optional decoration — a
 * message about "some pins" the GM cannot act on would be worse than silence.
 *
 * No paths, no ids, no counts of database rows: what happened, and what they may
 * want to do about it.
 */
export function toastUnlinkedPins(count: number, onShowPins: () => void) {
  // A permanent toast belongs to the ledger that raised it. Opening another one
  // with nothing to repair has to take it down, or a message about vault A's pins
  // hangs over vault B and its "Show pins" opens an empty list.
  if (count === 0) {
    toast.dismiss("unlinked-pins");
    return;
  }
  toast(
    `${count} pin${count === 1 ? "" : "s"} lost ${count === 1 ? "its" : "their"} note`,
    {
      id: "unlinked-pins",
      duration: Infinity,
      closeButton: true,
      description:
        "Some of this ledger's bookkeeping was repaired when it opened. Your notes are intact, but these pins need linking to them again.",
      action: { label: "Show pins", onClick: onShowPins },
    },
  );
}

/**
 * Show an undo toast. `onConfirm` runs after the toast's duration unless Undo is clicked.
 *
 * NOTHING IS DELETED UNTIL THE WINDOW ELAPSES — the destructive call is what gets
 * deferred, so Undo is a cancelled timer rather than a restore. That is what makes undo
 * lossless here: a pin's tags and id survive because the delete never happened, and no
 * caller has to know how to rebuild the thing it just removed.
 *
 * `onUndo` is for callers that hid the thing OPTIMISTICALLY, which is the right move
 * wherever the deletion is visual — a pin the GM is looking at should leave the map on
 * click, not sit there for five seconds looking like the button failed. Those callers
 * put it back here. Callers that leave their UI alone until the timer fires (the file
 * tree) pass nothing and are unaffected.
 */
export function toastUndo(
  message: string,
  onConfirm: () => void,
  onUndo?: () => void,
  duration = 5000,
) {
  const timerId = setTimeout(onConfirm, duration);

  toast(message, {
    duration,
    action: {
      label: "Undo",
      onClick: () => {
        clearTimeout(timerId);
        onUndo?.();
      },
    },
  });
}
