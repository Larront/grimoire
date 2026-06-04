import { api } from "$lib/api";

interface AppPrefsData {
  reduceMotion: boolean;
  confirmRenameLinks: boolean;
  sampleBannerDismissed: boolean;
}

// Pre-migration webview localStorage keys. Read once on load() to carry old
// values into the Rust-side app-prefs file, then removed.
const LEGACY_KEYS: Record<keyof AppPrefsData, string> = {
  reduceMotion: "grimoire-reduce-motion",
  confirmRenameLinks: "grimoire-confirm-rename-links",
  sampleBannerDismissed: "grimoire-sample-banner-dismissed",
};

function createAppPrefs() {
  let reduceMotion = $state(false);
  let confirmRenameLinks = $state(false);
  let sampleBannerDismissed = $state(false);
  let loaded = false;

  function snapshot(): AppPrefsData {
    return { reduceMotion, confirmRenameLinks, sampleBannerDismissed };
  }

  /** Persist the full prefs snapshot to the Rust-side app-prefs file (fire-and-forget). */
  function persist() {
    api.saveAppPrefs(snapshot()).catch(console.error);
  }

  /** Fold any pre-migration localStorage values into state; returns true if any were found. */
  function migrateLegacyKeys(): boolean {
    if (typeof window === "undefined") return false;
    let migrated = false;
    for (const [pref, key] of Object.entries(LEGACY_KEYS) as [
      keyof AppPrefsData,
      string,
    ][]) {
      const value = window.localStorage.getItem(key);
      if (value === null) continue;
      migrated = true;
      if (value === "true") {
        if (pref === "reduceMotion") reduceMotion = true;
        if (pref === "confirmRenameLinks") confirmRenameLinks = true;
        if (pref === "sampleBannerDismissed") sampleBannerDismissed = true;
      }
      window.localStorage.removeItem(key);
    }
    return migrated;
  }

  /** Load persisted prefs from Rust. Called once at app startup. */
  async function load(): Promise<void> {
    if (loaded) return;
    loaded = true;
    try {
      const saved = await api.getAppPrefs();
      if (saved) {
        reduceMotion = saved.reduceMotion ?? false;
        confirmRenameLinks = saved.confirmRenameLinks ?? false;
        sampleBannerDismissed = saved.sampleBannerDismissed ?? false;
      }
      if (migrateLegacyKeys()) {
        persist();
      }
    } catch (e) {
      console.error("[app-prefs] failed to load app prefs:", e);
    }
  }

  function setReduceMotion(value: boolean) {
    reduceMotion = value;
    persist();
  }

  function setConfirmRenameLinks(value: boolean) {
    confirmRenameLinks = value;
    persist();
  }

  function setSampleBannerDismissed(value: boolean) {
    sampleBannerDismissed = value;
    persist();
  }

  return {
    get reduceMotion() {
      return reduceMotion;
    },
    setReduceMotion,
    get confirmRenameLinks() {
      return confirmRenameLinks;
    },
    setConfirmRenameLinks,
    get sampleBannerDismissed() {
      return sampleBannerDismissed;
    },
    setSampleBannerDismissed,
    load,
  };
}

export const appPrefs = createAppPrefs();
