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

/**
 * The operating system's own reduced-motion setting, read once at load.
 *
 * Grimoire's toggle is the GM's answer, not the platform's, so this is only ever used to
 * decide what the toggle STARTS at — see `load()`. Before this, the answer was always
 * "off", which meant a GM who had asked their OS for reduced motion got the full-motion
 * app until they went looking through Settings for a preference they had already
 * expressed once.
 */
function systemPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

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
    for (const [pref, key] of Object.entries(LEGACY_KEYS) as [keyof AppPrefsData, string][]) {
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

  /**
   * Load persisted prefs from Rust. Called once at app startup.
   *
   * `getAppPrefs` answers `null` when no prefs file exists at all, which is the one
   * moment nobody has chosen anything — so that is where the OS setting is allowed to
   * decide, and the only place. Once the GM has a prefs file, their stored answer wins
   * over the platform's for good, including an explicit "no" that happens to disagree
   * with it. Following the system on every launch would silently overrule them.
   *
   * Seeded, not saved: the value is left unpersisted until the GM touches something, so
   * a system setting they later change still carries over to a run where they have never
   * expressed a preference of their own.
   */
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
      const migrated = migrateLegacyKeys();
      // After the migration, not before it: a pre-migration localStorage value is also a
      // preference the GM once expressed, so it outranks the platform in the same way a
      // prefs file does. The seed applies only when neither source has anything to say.
      if (!saved && !migrated) {
        reduceMotion = systemPrefersReducedMotion();
      }
      if (migrated) {
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
