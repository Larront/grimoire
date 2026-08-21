// The Statblock Preset store (#179) — the GM's saved shapes, and the pointer at which
// one this vault stamps.
//
// Two lifetimes in one store, which is the shape of the feature rather than an
// accident: the **shapes are app-wide**, loaded once per launch, while the **default
// pointer is this vault's**, so it is re-read whenever the open ledger changes. Keying
// the pointer on `ledger.path` rather than listening for an open event keeps the
// dependency one-way — nothing in the ledger's own store has to know presets exist.
//
// Every read here is silent by design. `/statblock` resolves mid-session, often
// mid-fight, and a toast fires where the GM cannot act on it; a failure leaves the
// list empty, which stamps a blank statblock. Writes are the opposite — a GM pressed
// Save and is owed an answer — so they surface through the toasting `api`.
import { api } from "$lib/api";
import { ledger } from "$lib/stores/ledger.svelte";
import {
  availablePresets,
  findPreset,
  isShippedName,
  resolvePreset,
  type StatblockPreset,
} from "$lib/editor/statblock-presets";

/**
 * The shipped names are not the GM's to take. The two shipped presets cannot be edited
 * or deleted, and a saved shape of the same name would be exactly that by another
 * route — so the write is refused here rather than quietly winning or quietly losing.
 * The guard sits behind the UI, which disables Save for the same names.
 */
function reserved(name: string): void {
  if (isShippedName(name)) {
    throw new Error(`ERR_NAME_RESERVED: “${name.trim()}” is a built-in preset`);
  }
}

function createStatblockPresets() {
  let stored = $state<StatblockPreset[]>([]);
  let defaultName = $state<string | null>(null);

  let loading: Promise<void> | null = null;
  /** The ledger path the pointer was last read for — `undefined` means "never". */
  let pointerFor: string | null | undefined = undefined;

  /** The app-wide shapes, loaded once and then kept current by the writes below. */
  async function loadStored(): Promise<void> {
    if (loading) return loading;
    loading = (async () => {
      try {
        stored = (await api.silent.listStatblockPresets()) ?? [];
      } catch {
        // Leave the list as it was. On the first load that is empty, which stamps a
        // blank statblock — the same silence an unresolvable default gets.
      }
    })();
    return loading;
  }

  /**
   * Re-read the pointer if — and only if — a different vault is open. With no ledger
   * open the read still happens and answers nothing, which is the same absence as an
   * unset pointer and needs no branch of its own.
   */
  async function loadDefault(): Promise<void> {
    const path = ledger.path;
    if (pointerFor === path) return;
    pointerFor = path;
    try {
      defaultName = (await api.silent.getStatblockPresetDefault()) ?? null;
    } catch {
      defaultName = null;
    }
  }

  async function load(): Promise<void> {
    await Promise.all([loadStored(), loadDefault()]);
  }

  /**
   * Read both again from scratch.
   *
   * Called after every write, and whenever Settings opens: the presets file is app
   * data, so a second Grimoire window on the same machine can have changed it since
   * this one last looked. Silent — the write it follows has already reported itself,
   * and a failed re-read leaves the list as it was rather than emptying it.
   */
  async function reload(): Promise<void> {
    loading = null;
    pointerFor = undefined;
    try {
      await load();
    } catch {
      // load() swallows its own failures; this is belt and braces.
    }
  }

  /** Point this vault at a preset by name, or at nothing — which is blank. */
  async function setDefault(name: string | null): Promise<void> {
    await api.saveStatblockPresetDefault(name);
    defaultName = name;
    pointerFor = ledger.path;
  }

  return {
    /** Only the GM's own — what Settings offers rename and delete on. */
    get stored() {
      return stored;
    },
    /** Everything stampable: the shipped two, then the GM's. */
    get available() {
      return availablePresets(stored);
    },
    /** The vault's pointer, verbatim — including a name that no longer resolves. */
    get defaultName() {
      return defaultName;
    },
    /** Whether the pointer names a preset that exists. Settings' `(not found)`. */
    get defaultResolves() {
      return defaultName === null || findPreset(availablePresets(stored), defaultName) !== null;
    },

    load,
    reload,

    /**
     * The preset a `/statblock` stamps, or `null` for a blank one. Silent both ways:
     * an argument that misses, a pointer that dangles and a store that failed to load
     * all arrive here as the same absence.
     */
    async resolve(argument: string): Promise<StatblockPreset | null> {
      await load();
      return resolvePreset(argument, availablePresets(stored), defaultName);
    },

    /** Save a shape under a name, overwriting any shape already saved under it. */
    async save(name: string, fence: string): Promise<void> {
      reserved(name);
      await api.saveStatblockPreset(name, fence);
      await reload();
    },

    /**
     * Rename one of the GM's own shapes.
     *
     * The vault's default pointer is a *name* and is left exactly as it was, even when
     * it named this preset — the same rule delete follows, and for the same reason.
     * Re-pointing would only ever fix the vault that happens to be open, since the
     * shapes are app-wide and every other vault's pointer would dangle regardless.
     * A dangling pointer is not an error state; Settings names it and the GM re-picks.
     */
    async rename(from: string, to: string): Promise<void> {
      reserved(to);
      await api.renameStatblockPreset(from, to);
      await reload();
    },

    /**
     * Delete a shape. The pointer is deliberately left pointing at it: a vault whose
     * default was deleted on *this* machine may still resolve it on another, and
     * clearing the pointer here would silently un-choose a preset the GM never
     * un-chose. Settings shows it as `<name> (not found)` until they act.
     */
    async remove(name: string): Promise<void> {
      await api.deleteStatblockPreset(name);
      await reload();
    },

    setDefault,
  };
}

export const statblockPresets = createStatblockPresets();
