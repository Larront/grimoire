// Ledger images — the three things a block needs to show one, acquire one, and know
// when it is not there.
//
// This is the reusable part of an image inside a block, and the reason the Infobox's
// thumbnail is a path attribute rather than a composed Image node (#176): what Image
// and Infobox genuinely share is *a ledger-relative path, resolved, with its loading
// and not-found states*, and that is a function rather than a node. Composing the node
// would have made the Infobox a container for a single fixed child to reuse this file.
//
// Both halves of a path's life are here, because both are the same knowledge: a note
// stores a ledger-relative path, the webview needs an asset URL, and the ledger — not
// the GM's disk — is where an image a note points at has to live.
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "$lib/api";

/** The image file types Grimoire copies into the ledger. */
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp"];

/**
 * A ledger-relative path as a URL the webview can load.
 *
 * Rejects when the path resolves to nothing — a file moved or deleted outside
 * Grimoire — which callers turn into a not-found state rather than an error.
 */
export async function resolveLedgerImage(relativePath: string): Promise<string> {
  return convertFileSrc(await api.getImageAbsolutePath(relativePath));
}

/** A path's resolution as a block draws it: a URL, or nothing yet, or nothing ever. */
export interface LedgerImage {
  /** The asset URL, or null while it is resolving and once it has failed. */
  readonly url: string | null;
  /** The file cannot be drawn: the path resolved to nothing, or the bytes did not. */
  readonly missing: boolean;
  /**
   * What an `<img>`'s `onerror` calls. A path can resolve to a real file that the
   * webview still cannot decode — a truncated download, a renamed non-image — and a
   * block that only watched the *path* would draw the browser's broken-image glyph
   * instead of saying what happened.
   */
  markMissing: () => void;
}

/**
 * Resolves a path and keeps resolving it as it changes, for a block to draw.
 *
 * A rune rather than a promise per view because both halves matter: the *stale reply*
 * (a GM replacing an image twice quickly must not have the first resolution overwrite
 * the second) and the *reset* — a path change clears the previous URL, so no view ever
 * shows the old file under the new path. Called during a component's setup, like any
 * other rune.
 */
export function ledgerImage(path: () => string): LedgerImage {
  let url = $state<string | null>(null);
  let missing = $state(false);

  $effect(() => {
    const current = path();
    url = null;
    missing = false;
    if (!current) return;

    let live = true;
    resolveLedgerImage(current)
      .then((resolved) => {
        if (live) url = resolved;
      })
      .catch(() => {
        if (live) missing = true;
      });
    // A path that changed while its resolution was in flight: the reply that arrives
    // second is the one that counts, and the first must not land at all.
    return () => {
      live = false;
    };
  });

  return {
    get url() {
      return url;
    },
    get missing() {
      return missing;
    },
    markMissing() {
      url = null;
      missing = true;
    },
  };
}

/**
 * Asks the GM for an image file, copies it into the ledger, and hands back its
 * ledger-relative path — or `null` if they picked nothing.
 *
 * The copy is what makes a note portable: a path into the GM's Pictures folder would
 * break the moment the campaign moved machines. Swallows a failed copy for the same
 * reason every other insertion route does: there is nothing useful to say, and a
 * half-written attribute would be worse than no change at all.
 */
export async function pickLedgerImage(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    multiple: false,
    filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
  });
  if (typeof picked !== "string") return null;
  return api.copyImageFile(picked).catch(() => null);
}
