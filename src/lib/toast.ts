import { toast } from "svelte-sonner";
import MigrationReportBody from "$lib/components/toasts/MigrationReportBody.svelte";
import type { SalvageSummary } from "$lib/bindings.gen";

// Errors auto-expire like every other toast: the tool must never pin a
// permanent surface to the corner during live play (DESIGN.md — "the tool
// disappears"). Longer than success — error copy is denser and higher-stakes —
// but still finite.
//
// The sanctioned exceptions are Conflict-Banner-class: a state that outlives the
// session, that the GM has to act on, and that is non-destructive to ignore —
// `toastMigrationReport`'s failure branch (notes a [[Format Migration]] left on a
// format nothing reads, #184) and the database recovery notices. None licenses
// permanent toasts for work the app has finished. What a *ledger* needs from the
// GM — pins that lost their note, notes that couldn't be opened, links to a note
// moved outside Grimoire — is not a toast at all (2026-10 design review): it waits
// in the ledger menu and on the Ledger Home (`needs-attention.svelte.ts`).
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

/** A confirmation, with an optional way straight to what it made. Longer when it
 *  carries one, so there is time to reach the button. */
export function toastSuccess(message: string, action?: { label: string; onClick: () => void }) {
  toast.success(message, { duration: action ? 6000 : 3000, action });
}

/**
 * What a completed [[Format Migration]] leaves on screen (#184).
 *
 * The report is the record — a markdown file beside the backup, which outlives
 * the session — so this only **points at it**. A clean sweep is news rather than
 * an unresolved state, so it fades like everything else.
 *
 * **A partial failure is a sanctioned permanent toast.** ADR-0014's rule was "a
 * persistent toast is for an unresolved *external* change", and this one is
 * Grimoire's own doing, so the rule as written does not cover it — #184 widens it on
 * the property that actually earned the exception: notes are left on a format
 * nothing reads, the state outlives the session, and ignoring it is non-destructive.
 * It is not corner-noise about something the app already finished. (The external
 * move's toast it once stood beside is gone: links to a moved note now wait in the
 * world's "needs attention" place, with pins and unreadable notes — 2026-10 review.)
 *
 * Nothing at all when nothing was rewritten: the plan is recomputed at migrate
 * time, so a vault whose work vanished in between just opens (and an earlier
 * word about it is taken down).
 */
const FORMAT_UPDATE_ID = "format-migration";

/** A note as the GM knows it: its name, not its path. */
function noteName(path: string): string {
  const name = path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
  return path.startsWith(".grimoire/templates/") ? `${name} (template)` : name;
}

/** "A", "A and B", "A, B and C", "A, B, C and 4 more". */
function noteList(paths: string[]): string {
  const names = paths.map(noteName);
  if (names.length <= 1) return names.join("");
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

export function dismissFormatUpdate() {
  toast.dismiss(FORMAT_UPDATE_ID);
}

// Revised in the 2026-10 design review: it names the world and the notes; when a
// line of the GM's own writing changed, it says where and stays up until closed
// (the prompt promised that change, and an eight-second toast forgot it); and a
// partial failure is calm — nothing was lost — names what wasn't updated, and offers
// Try again. It belongs to its world: opening or closing one takes it down.
export function toastMigrationReport(
  world: string,
  report: {
    migrated: string[];
    notes: { path: string; warnings: string[] }[];
    failed: { path: string; reason: string }[];
    report_path: string;
  },
  onTryAgain: () => void,
) {
  const done = report.migrated.length;
  const failed = report.failed.length;
  if (done === 0 && failed === 0) {
    // A Try again that found the work already done: the old word is now untrue.
    dismissFormatUpdate();
    return;
  }

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
    // A Try again that worked replaces the failure toast in place, and an update
    // keeps whatever it doesn't name — the old Try again included. The failure
    // branch sets its own after this.
    action: undefined,
  });

  if (failed > 0) {
    const one = failed === 1;
    const updated = done ? ` ${done} ${done === 1 ? "was" : "were"} updated.` : "";
    toast(`“${world}”: ${failed} note${one ? " wasn't" : "s weren't"} updated`, {
      id: FORMAT_UPDATE_ID,
      // Not `Infinity` — see `toastUnlinkedPins`.
      duration: 2 ** 31 - 1,
      closeButton: true,
      ...body(
        `${noteList(report.failed.map((f) => f.path))} couldn't be written — ${
          one ? "it may be" : "they may be"
        } read-only or open in another program. ${one ? "It's" : "They're"} untouched.${updated} The report:`,
      ),
      action: {
        label: "Try again",
        onClick: (e) => {
          e.preventDefault();
          onTryAgain();
        },
      },
    });
    return;
  }

  const changed = report.notes.filter((n) => n.warnings.length > 0);
  const title = `“${world}”: ${done} note${done === 1 ? "" : "s"} updated`;
  if (changed.length > 0) {
    // The GM was told a line of their own writing would change: say where.
    const first = changed[0];
    const lines = changed.reduce((n, note) => n + note.warnings.length, 0);
    const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
    const where =
      lines === 1
        ? `${noteName(first.path)}: ${lower(first.warnings[0])}`
        : `${lines} lines of your own writing changed, in ${noteList(changed.map((n) => n.path))}.`;
    // One note, and it's the one that changed: name it once.
    const which = done === 1 ? "" : `${noteList(report.migrated)}. `;
    toast(title, {
      id: FORMAT_UPDATE_ID,
      duration: 2 ** 31 - 1,
      closeButton: true,
      ...body(`${which}${where} Copies from before, and the report:`),
    });
    return;
  }

  toast(title, {
    id: FORMAT_UPDATE_ID,
    duration: ERROR_DURATION,
    closeButton: true,
    ...body(`${noteList(report.migrated)}. Copies from before, and the report:`),
  });
}

/**
 * Show an undo toast. `onConfirm` runs when the toast closes, unless Undo was clicked.
 *
 * NOTHING IS DELETED WHILE THE TOAST IS UP — the destructive call is what gets deferred,
 * so Undo is a cancelled commit rather than a restore. That is what makes undo lossless
 * here: a pin's tags and id survive because the delete never happened, and no caller has
 * to know how to rebuild the thing it just removed.
 *
 * The commit is the toast closing, not a timer of its own (2026-10 design review). The
 * toast stops counting down while the pointer rests on it, and a separate five-second
 * timer did not — so a GM reaching for Undo could find it still offered after the delete
 * had happened, and clicking it did nothing. Closed by its timer or by its ✕, it commits;
 * closed by Undo, it doesn't.
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
  // Settled once, either way: Undo also closes the toast, and that close must not then
  // commit what Undo just cancelled.
  let settled = false;
  const commit = () => {
    if (settled) return;
    settled = true;
    onConfirm();
  };

  toast(message, {
    duration,
    onAutoClose: commit,
    onDismiss: commit,
    action: {
      label: "Undo",
      onClick: () => {
        if (settled) return;
        settled = true;
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
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
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
