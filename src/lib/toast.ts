import { toast } from "svelte-sonner";
import MigrationReportBody from "$lib/components/toasts/MigrationReportBody.svelte";
import type { SalvageSummary } from "$lib/bindings.gen";

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

/**
 * Notes Grimoire couldn't read when the world opened (2026-10 design review).
 *
 * Calm and lasting, on the terms the unlinked-pins toast sets: nothing was lost —
 * the files are untouched and keep their records — so this is not an alarm, but the
 * state outlives a glance (a cloud-only file stays unreadable until the sync app
 * runs) and only the GM can resolve it. It used to be a red ten-second error whose
 * list was gone once read. Counts down in place as notes come good; goes at zero.
 */
export function toastUnreadableNotes(count: number, someFixed: boolean, onShow: () => void) {
  if (count === 0) {
    toast.dismiss("import-failures");
    return;
  }
  const one = count === 1;
  toast(
    someFixed
      ? `${count} note${one ? "" : "s"} still can't be opened`
      : `${count} note${one ? "" : "s"} couldn't be opened`,
    {
      id: "import-failures",
      // Not `Infinity` — see `toastUnlinkedPins`.
      duration: 2 ** 31 - 1,
      closeButton: true,
      description: `${one ? "It's" : "They're"} safe in your world's folder, untouched. Grimoire couldn't read ${
        one ? "it" : "them"
      } this time.`,
      action: {
        label: "Show notes",
        onClick: (e) => {
          e.preventDefault();
          onShow();
        },
      },
    },
  );
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
export function toastExternalMoveLinks(oldName: string, count: number, onUpdate: () => void) {
  toast(`'${oldName}' moved externally. Update ${count} backlink${count === 1 ? "" : "s"}?`, {
    duration: Infinity,
    action: { label: "Update", onClick: onUpdate },
    // Clicking cancel dismisses the toast; there is no backend call — leaving
    // the backlinks as they are on disk is a safe, non-destructive choice.
    cancel: { label: "Leave as-is", onClick: () => {} },
  });
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
    toast.error(`${failed} note${failed === 1 ? "" : "s"} couldn't be updated`, {
      id: "format-migration",
      duration: Infinity,
      closeButton: true,
      ...body(
        `${done} of ${done + failed} were updated. The rest are still in the old format — the report lists them:`,
      ),
    });
    return;
  }

  toast(`${done} note${done === 1 ? "" : "s"} updated`, {
    id: "format-migration",
    duration: ERROR_DURATION,
    closeButton: true,
    ...body("Copies of them from before the change, and a report of what changed, are here:"),
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
export function toastUnlinkedPins(count: number, someFixed: boolean, onShowPins: () => void) {
  // A permanent toast belongs to the ledger that raised it. Opening another one
  // with nothing to repair has to take it down, or a message about vault A's pins
  // hangs over vault B and its "Show pins" opens an empty list. And it goes when
  // the last pin is fixed.
  if (count === 0) {
    toast.dismiss("unlinked-pins");
    return;
  }
  const one = count === 1;
  const pins = `${count} pin${one ? "" : "s"}`;
  // Raised again under the same id as pins are fixed, so it counts down in place.
  toast(
    someFixed
      ? `${pins} still need${one ? "s" : ""} ${one ? "its" : "their"} note`
      : `${pins} lost ${one ? "its" : "their"} note`,
    {
      id: "unlinked-pins",
      // Permanent, but not `Infinity`: svelte-sonner restarts an updated toast's timer
      // with its duration, and `setTimeout(fn, Infinity)` fires at once — so counting
      // this toast down closed it. The longest delay a timer takes (~24 days) is the
      // same promise and survives the update.
      duration: 2 ** 31 - 1,
      closeButton: true,
      // Not "when it opened": the same repair runs mid-session too.
      description: `Grimoire repaired this world's records. Your notes are intact, but ${
        one ? "this pin needs" : "these pins need"
      } linking to ${one ? "its" : "their"} note again.`,
      action: {
        label: "Show pins",
        // The toast stays: it is how the GM gets back to the list after fixing one.
        onClick: (e) => {
          e.preventDefault();
          onShowPins();
        },
      },
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

/**
 * A damaged database recovered on open (#116, 2026-10 design review): restored from
 * the last backup, or rebuilt from the notes. Lasting — the GM may be mid-prep and
 * should be able to read what is missing — but closable, and taken down by the next
 * open (`dismissDbRecovery`). It used to be a toast with no close button that
 * followed the GM to the Splash and into every other world.
 */
const DB_RECOVERY_ID = "db-recovery";

export function toastDbRestored(
  world: string,
  takenAt: string,
  onShowDamaged: (() => void) | null,
) {
  const when = new Date(takenAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  toast(`“${world}” was restored from its last backup`, {
    id: DB_RECOVERY_ID,
    duration: 2 ** 31 - 1,
    closeButton: true,
    description: `Its scenes, maps, pins and Quick Notes are as they were on ${when}; changes to them after that couldn't be kept. Your notes are unaffected.`,
    action: onShowDamaged
      ? {
          label: "Show damaged file",
          onClick: (e) => {
            e.preventDefault();
            onShowDamaged();
          },
        }
      : undefined,
  });
}

/** `n` things, singular or plural: "1 pin", "14 pins". */
function count(n: number, singular: string, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * A damaged database with no usable backup, salvaged by SQLite's own recovery on the
 * way in (2026-10 design review): what it read back of what only the database holds.
 * What sat on the damaged part of the file is lost, and nothing can say what that was,
 * so the toast says so rather than implying a whole world came back.
 */
export function toastDbSalvaged(
  world: string,
  salvaged: SalvageSummary,
  onShowDamaged: (() => void) | null,
) {
  const parts = [
    salvaged.scenes && count(salvaged.scenes, "scene"),
    salvaged.maps && count(salvaged.maps, "map"),
    salvaged.pins && count(salvaged.pins, "pin"),
    salvaged.quick_notes && count(salvaged.quick_notes, "Quick Note"),
  ].filter((p): p is string => !!p);
  const list =
    parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  const m = salvaged.maps_from_images;
  const fromImages =
    m > 0
      ? ` ${count(m, "more map", "more maps")} came back from ${m === 1 ? "its image" : "their images"}, without pins.`
      : "";
  toast(`“${world}” was recovered from its damaged database`, {
    id: DB_RECOVERY_ID,
    duration: 2 ** 31 - 1,
    closeButton: true,
    description: `${list} came back; anything on the damaged part of the file couldn't.${fromImages} Your notes are unaffected.`,
    action: onShowDamaged
      ? {
          label: "Show damaged file",
          onClick: (e) => {
            e.preventDefault();
            onShowDamaged();
          },
        }
      : undefined,
  });
}

export function toastDbRebuilt(
  world: string,
  mapsRecovered: number,
  onShowDamaged: (() => void) | null,
) {
  const n = mapsRecovered;
  toast(`“${world}” was rebuilt from its notes`, {
    id: DB_RECOVERY_ID,
    duration: 2 ** 31 - 1,
    closeButton: true,
    description:
      n > 0
        ? `Its ${n} map${n === 1 ? "" : "s"} came back from ${n === 1 ? "its image" : "their images"}, without pins. Its scenes and Quick Notes couldn't be recovered.`
        : "Its scenes, maps and Quick Notes couldn't be recovered.",
    action: onShowDamaged
      ? {
          label: "Show damaged file",
          onClick: (e) => {
            e.preventDefault();
            onShowDamaged();
          },
        }
      : undefined,
  });
}

export function dismissDbRecovery() {
  toast.dismiss(DB_RECOVERY_ID);
}
