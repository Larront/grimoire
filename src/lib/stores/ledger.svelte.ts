import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, friendlyMessage } from "$lib/api";
import {
  dismissDbRecovery,
  dismissFormatUpdate,
  toastDbRebuilt,
  toastDbRestored,
  toastDbSalvaged,
  toastError,
  toastMigrationReport,
} from "$lib/toast";
import { unreadableNotes } from "$lib/stores/unreadable-notes.svelte";
import { unlinkedPins } from "$lib/stores/unlinked-pins.svelte";
import { pendingSaves } from "$lib/stores/pending-saves";
import { LocalStorageTabPersistence } from "$lib/stores/tab-persistence";
import { appPrefs, type DensityLevel } from "$lib/stores/app-prefs.svelte";
import type { MigrationPlan, MigrationReport, SalvageSummary } from "$lib/bindings.gen";

export type AccentPreset =
  | "accent-crimson"
  | "accent-arcane"
  | "accent-verdant"
  | "accent-ice"
  | "accent-amber";

export type { DensityLevel } from "./app-prefs.svelte";

export interface FailedImport {
  path: string;
  reason: string;
}

/** A pin a repair left pointing at nothing (#224) — see `unlinked-pins.svelte.ts`. */
export type { UnlinkedPin } from "$lib/bindings.gen";
import type { UnlinkedPin } from "$lib/bindings.gen";

interface OpenLedgerResult {
  path: string;
  note_count: number;
  scene_count: number;
  map_count: number;
  failed_imports: FailedImport[];
  /** Pins the open-time notes repair unlinked (issue #224). Empty on every
   *  ordinary open. */
  unlinked_pins: UnlinkedPin[];
  /** RFC 3339 date of the snapshot the DB was auto-restored from (issue #116). */
  recovered_from_backup: string | null;
  /** Where a damaged database was kept, after a restore, a salvage or a rebuild. */
  damaged_file?: string | null;
  /** Set when a damaged database with no backup was salvaged on the way in. */
  salvaged?: SalvageSummary | null;
  /** Set only by a rebuild: what came back besides the notes. */
  rebuilt?: { maps_recovered: number } | null;
}

/** A world's name as the GM sees it: its folder's. */
export function worldNameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Show a kept damaged database in its folder. */
function showDamaged(file: string | null | undefined): (() => void) | null {
  return file ? () => void revealItemInDir(file).catch(() => {}) : null;
}

export interface RecentLedger {
  path: string;
  name: string;
  note_count: number;
  scene_count: number;
  map_count: number;
  last_opened: string;
  /** Derived by the backend at read time: folder not found on disk. */
  missing?: boolean;
}

function createLedgerStore() {
  let path = $state<string | null>(null);
  let isOpen = $state(false);
  // Bumped by every successful open, including a reopen of the ledger already
  // open. The path can't say "opened again": re-exploring the Example World
  // reopens the same sandbox path over a freshly reset database, so anything
  // that reloads on a path change keeps serving rows that are gone.
  let openGeneration = $state(0);
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let accent = $state<AccentPreset>("accent-crimson");
  let isSample = $state(false);
  let pendingStartHere = $state(false);
  // Set when open_ledger reported ERR_DB_CORRUPT with no usable snapshot —
  // DbRecoveryDialog (mounted in the root layout) offers Rebuild/Cancel.
  let corruptLedgerPath = $state<string | null>(null);
  /** Why the last rebuild failed, in the GM's words — shown in the rebuild dialog. */
  let rebuildError = $state<string | null>(null);
  // Set when open_ledger refused because the vault's notes are on an older
  // format (ADR-0017) — FormatMigrationDialog (also in the root layout) composes
  // its copy from this plan and offers Update/Cancel. Declining leaves it null
  // and the ledger closed: the refusal that put it here simply stands.
  let formatMigration = $state<{ path: string; plan: MigrationPlan } | null>(null);
  /** Why the last update failed, in the GM's words — shown in the update prompt. */
  let migrateError = $state<string | null>(null);

  /** Applies a successful open_ledger result to store state and surfaces
   *  failed imports and snapshot recovery — and, when the open came from a note
   *  format update, how that went. */
  function applyOpenResult(result: OpenLedgerResult, formatUpdate?: MigrationReport): void {
    path = result.path;
    isOpen = true;
    openGeneration++;
    // An open is of an ordinary world unless the caller says otherwise —
    // `exploreSample` sets this back after its open. Switching worlds from inside the
    // Example World used to leave the next one labelled "Example World".
    isSample = false;

    // Every open, empty or not: a world that reads cleanly takes the last one's
    // list, and its toast, down.
    unreadableNotes.replace(result.failed_imports);

    // A repair that changed nothing says nothing — the common case, and the
    // silence there is correct. When it did act, the pins it cost the GM are
    // named rather than counted (issue #224).
    unlinkedPins.replace(result.unlinked_pins);

    // A damaged database recovered on the way in (#116): say what came back and what
    // didn't, lastingly; any other open takes the last such word down.
    const world = worldNameOf(result.path);
    if (result.rebuilt) {
      toastDbRebuilt(world, result.rebuilt.maps_recovered, showDamaged(result.damaged_file));
    } else if (result.recovered_from_backup) {
      toastDbRestored(world, result.recovered_from_backup, showDamaged(result.damaged_file));
    } else if (result.salvaged) {
      toastDbSalvaged(world, result.salvaged, showDamaged(result.damaged_file));
    } else {
      dismissDbRecovery();
    }
    // A note-format update's word belongs to the world it was about. A Try again
    // replaces it in place: dismissing first would take the new word down with the
    // old, since the toast library removes by id.
    if (formatUpdate) {
      toastMigrationReport(world, formatUpdate, () =>
        runFormatUpdate(result.path).catch((e) => toastError(friendlyMessage(e))),
      );
    } else {
      dismissFormatUpdate();
    }
  }

  /** Invokes open_ledger, updates store state, and surfaces failed imports. */
  async function openAtPath(ledgerPath: string): Promise<OpenLedgerResult> {
    // Flush pending editor saves while the outgoing ledger is still open, so
    // a debounced edit is never dropped or written into the wrong ledger.
    await pendingSaves.flushAll();
    try {
      // The quiet surface, so a refusal that becomes a dialog is not also toasted:
      // reporting is this function's own job below, once the routing has decided
      // whether anything else is going to speak.
      const result = await api.silent.openLedger(ledgerPath);
      applyOpenResult(result);
      return result;
    } catch (e) {
      const routed = await routeOpenRefusal(ledgerPath, e);
      if (!routed) toastError(friendlyMessage(e));
      throw e;
    }
  }

  /** Turn a refusal from an open into the dialog that resolves it, if there is
   *  one. Shared by both ways in — a plain open and a post-rebuild open — because
   *  a ledger can be damaged *and* behind, and the rebuild path reaching the
   *  format refusal with no prompt would be a dead end.
   *
   *  Returns whether a prompt took the refusal over, which is what decides if it
   *  is also toasted. Both prompts answer yes: each states the whole refusal and its
   *  ways out, so a toast beside it says less than the dialog behind it. The rebuild
   *  prompt used to be left reporting too, and the GM got the dialog's title again
   *  as a red toast they couldn't even close while the dialog was up (2026-10 design
   *  review). */
  async function routeOpenRefusal(ledgerPath: string, e: unknown): Promise<boolean> {
    const raw = String(e);
    if (raw.includes("ERR_DB_CORRUPT")) {
      corruptLedgerPath = ledgerPath;
      rebuildError = null;
      return true;
    }
    if (raw.includes("ERR_FORMAT_MIGRATION_REQUIRED")) {
      // Ask the scan what would change, so the prompt is composed from the
      // migrations that actually found work rather than written in advance.
      // A plan we cannot obtain means no prompt: the refusal stands, which is
      // the same place a decline leaves the GM.
      const plan = await api.silent.planFormatMigration(ledgerPath).catch(() => null);
      if (plan) {
        formatMigration = { path: ledgerPath, plan };
        // The database side is settled by the time this refusal is reached, so
        // the rebuild dialog must step aside rather than stack behind it.
        corruptLedgerPath = null;
        return true;
      }
    }
    return false;
  }

  async function openLedger(selectedPath?: string): Promise<boolean> {
    isLoading = true;
    error = null;

    try {
      const ledgerPath =
        selectedPath ??
        (await open({
          directory: true,
          title: "Open Ledger Folder",
        }));

      if (!ledgerPath || typeof ledgerPath !== "string") {
        isLoading = false;
        return false;
      }

      const result = await openAtPath(ledgerPath);
      recordRecent(result);
      return true;
    } catch (e) {
      error = String(e);
      throw e;
    } finally {
      isLoading = false;
    }
  }

  // Record in recent ledgers (fire-and-forget).
  // Item counts in this entry are set at open time and refreshed on the next open_ledger call.
  // In-session counts are derived reactively from notes.noteCount, scenes.sceneCount,
  // and maps.mapCount — these update immediately after store.load() calls in the sidebar.
  function recordRecent(result: OpenLedgerResult): void {
    const name = result.path.split(/[\\/]/).pop() ?? "Untitled";
    api.silent
      .addRecentLedger({
        path: result.path,
        name,
        note_count: result.note_count,
        scene_count: result.scene_count,
        map_count: result.map_count,
        last_opened: new Date().toISOString(),
        missing: false,
      })
      .catch(() => {});
  }

  /** Confirmed rebuild after ERR_DB_CORRUPT with no snapshot: the backend
   *  moves the damaged database aside and re-runs the open flow (notes are
   *  recovered from their files; scenes/pins/maps are not — the dialog that
   *  triggers this said so). */
  async function rebuildCorruptLedger(): Promise<boolean> {
    const target = corruptLedgerPath;
    if (!target) return false;
    isLoading = true;
    error = null;
    rebuildError = null;
    try {
      // Quiet: a failure is said in the dialog, beside the button that failed.
      const result = await api.silent.rebuildLedgerDb(target);
      applyOpenResult(result);
      recordRecent(result);
      corruptLedgerPath = null;
      return true;
    } catch (e) {
      // A rebuilt database can still be a vault whose *notes* are behind: the
      // rebuild ran, the format gate refused, and without this the GM would be
      // left with no way through. The migration prompt then says it all.
      await routeOpenRefusal(target, e);
      if (!formatMigration) {
        corruptLedgerPath = target;
        rebuildError = friendlyMessage(e);
      }
      error = String(e);
      throw e;
    } finally {
      isLoading = false;
    }
  }

  function dismissCorruptLedger(): void {
    corruptLedgerPath = null;
    rebuildError = null;
  }

  /** The GM said yes to the [[Format Migration]] prompt: the backend backs the
   *  affected notes up, rewrites them, writes its report, and opens the ledger.
   *  It opens even when some notes could not be rewritten — consent was given and
   *  the casualties are named — so the report is toasted either way, persistently
   *  when something failed. */
  async function migrateLedgerFormat(): Promise<boolean> {
    const target = formatMigration;
    if (!target) return false;
    isLoading = true;
    error = null;
    migrateError = null;
    try {
      await runFormatUpdate(target.path);
      formatMigration = null;
      return true;
    } catch (e) {
      // Said in the prompt, beside the button that failed — a toast raised under the
      // prompt can't even be clicked while it is up.
      migrateError = friendlyMessage(e);
      error = String(e);
      throw e;
    } finally {
      isLoading = false;
    }
  }

  /** Run the update over `ledgerPath`, open it, and say how it went — with a Try
   *  again on a partial failure that runs this again (the backend closes the open
   *  world first). */
  async function runFormatUpdate(ledgerPath: string): Promise<void> {
    const result = await api.silent.migrateLedgerFormat(ledgerPath);
    applyOpenResult(result.ledger, result.report);
    recordRecent(result.ledger);
  }

  /** Declining opens nothing: there is no compatibility mode, because with no
   *  reader for the old format an un-migrated vault would not expose the GM to a
   *  risk they accepted — it would destroy content they never see leave. */
  function dismissFormatMigration(): void {
    formatMigration = null;
    migrateError = null;
  }

  async function adopt(parent: string, name: string): Promise<boolean> {
    isLoading = true;
    error = null;
    try {
      // The copy is of what is on disk, so the last edits have to be there first —
      // as `exploreSample` flushes before it resets.
      await pendingSaves.flushAll();
      // Silent: the Adopt dialog says what went wrong, beside the field it is about,
      // and a generic toast on top of it said the same thing worse.
      const destPath = await api.silent.adoptSampleLedger(parent, name);
      const opened = await openLedger(destPath);
      if (!opened) {
        // openLedger only resolves false (without throwing) when no path was
        // chosen in the dialog — impossible here, but guard so isSample is
        // never cleared while the sandbox is still the open ledger.
        throw new Error("Failed to open the adopted ledger.");
      }
      isSample = false;
      return true;
    } catch (e) {
      error = String(e);
      throw e;
    } finally {
      isLoading = false;
    }
  }

  async function exploreSample(): Promise<boolean> {
    isLoading = true;
    error = null;
    try {
      // Flush before the backend wipes and re-copies the sandbox — if the
      // current ledger IS the sandbox, a later flush would write into the
      // freshly reset copy.
      await pendingSaves.flushAll();
      const sandboxPath = await api.exploreSampleLedger();
      // The backend just replaced the sandbox, so the tabs saved for it name notes,
      // maps and scenes of a copy that is gone — some made while exploring.
      new LocalStorageTabPersistence(sandboxPath).clear();
      await openAtPath(sandboxPath);
      isSample = true;
      pendingStartHere = true;
      return true;
    } catch (e) {
      error = String(e);
      throw e;
    } finally {
      isLoading = false;
    }
  }

  /** Where an earlier exploration of the example left it, or null when there is none. */
  async function existingSample(): Promise<string | null> {
    try {
      return (await api.silent.existingSampleLedger()) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Open the example as an earlier exploration left it: its notes, its tabs. The
   * Splash offers this beside starting over, which `exploreSample` does (2026-10
   * design review — exploring again used to wipe a GM's changes without a word).
   */
  async function continueSample(): Promise<boolean> {
    const sandboxPath = await existingSample();
    if (!sandboxPath) return exploreSample();
    isLoading = true;
    error = null;
    try {
      await openAtPath(sandboxPath);
      isSample = true;
      return true;
    } catch (e) {
      error = String(e);
      throw e;
    } finally {
      isLoading = false;
    }
  }

  /**
   * Density is app-wide now (`appPrefs.density`). This stays for the one ledger that had a
   * density of its own before, which `checkExistingLedger` hands over once.
   */
  function setDensity(level: DensityLevel): void {
    appPrefs.setDensity(level);
  }

  function setAccent(preset: AccentPreset): void {
    accent = preset;
    api.silent.saveAccentPreset(preset).catch(console.error);
  }

  async function getRecentLedgers(): Promise<RecentLedger[]> {
    try {
      return (await api.silent.getRecentLedgers()) ?? [];
    } catch {
      return [];
    }
  }

  async function closeLedger(): Promise<void> {
    await pendingSaves.flushAll();
    try {
      await api.closeLedger();
    } catch (e) {
      // Log but do not block frontend close — we still clear local state
      console.warn("[ledger] close_ledger command failed:", e);
    }
    path = null;
    isOpen = false;
    isSample = false;
    pendingStartHere = false;
    accent = "accent-crimson";
    error = null;
    // A world's own news goes with it: the restore or rebuild toast, and the note-
    // format update's, used to sit on over the Splash and the next world.
    dismissDbRecovery();
    dismissFormatUpdate();
  }

  async function checkExistingLedger(): Promise<void> {
    try {
      const existingPath = await api.getLedgerPath();
      if (existingPath) {
        path = existingPath;
        isOpen = true;
        openGeneration++;
      }
      const savedAccent = await api.getAccentPreset().catch(() => null);
      if (savedAccent) accent = savedAccent as AccentPreset;
      const savedDensity = await api.getDensityLevel().catch(() => null);
      if (savedDensity) appPrefs.adoptDensity(savedDensity);
    } catch {
      // No ledger open — normal on first launch
    }
  }

  return {
    get path() {
      return path;
    },
    get isOpen() {
      return isOpen;
    },
    /** Counts opens. Read it to re-run whenever a ledger is (re)opened — the
     *  path alone misses a reopen of the same ledger. */
    get openGeneration() {
      return openGeneration;
    },
    get isLoading() {
      return isLoading;
    },
    get error() {
      return error;
    },
    get accent() {
      return accent;
    },
    get density() {
      return appPrefs.density;
    },
    get isSample() {
      return isSample;
    },
    get pendingStartHere() {
      return pendingStartHere;
    },
    get rebuildError() {
      return rebuildError;
    },
    get corruptLedgerPath() {
      return corruptLedgerPath;
    },
    get formatMigration() {
      return formatMigration;
    },
    get migrateError() {
      return migrateError;
    },
    clearPendingStartHere() {
      pendingStartHere = false;
    },
    rebuildCorruptLedger,
    dismissCorruptLedger,
    migrateLedgerFormat,
    dismissFormatMigration,
    openLedger,
    adopt,
    exploreSample,
    existingSample,
    continueSample,
    closeLedger,
    checkExistingLedger,
    getRecentLedgers,
    setAccent,
    setDensity,
  };
}

export const ledger = createLedgerStore();
