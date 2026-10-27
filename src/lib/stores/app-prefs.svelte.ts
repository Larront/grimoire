import { api } from "$lib/api";
import { MediaQuery } from "svelte/reactivity";

export type DensityLevel = "cozy" | "balanced" | "dense";

const DENSITIES: readonly DensityLevel[] = ["cozy", "balanced", "dense"];
const asDensity = (value: unknown): DensityLevel | null =>
  DENSITIES.includes(value as DensityLevel) ? (value as DensityLevel) : null;

/**
 * Reduce Motion, as the GM chose it: follow the computer's own setting ("system", the
 * default), or always on, or always off. It was a switch seeded from the computer on the
 * first run only, after which the two could disagree — and parts of the app listened to
 * one and parts to the other (2026-10 design review).
 */
export type MotionChoice = "system" | "on" | "off";
const MOTION_CHOICES: readonly MotionChoice[] = ["system", "on", "off"];
const asMotionChoice = (value: unknown): MotionChoice | null =>
  MOTION_CHOICES.includes(value as MotionChoice) ? (value as MotionChoice) : null;

interface AppPrefsData {
  /** Kept for builds that read only this: true when motion is reduced by choice. */
  reduceMotion: boolean;
  reduceMotionChoice: MotionChoice;
  confirmRenameLinks: boolean;
  density: DensityLevel | null;
}

// Pre-migration webview localStorage keys. Read once on load() to carry old
// values into the Rust-side app-prefs file, then removed.
const LEGACY_KEYS: Record<Exclude<keyof AppPrefsData, "density" | "reduceMotionChoice">, string> = {
  reduceMotion: "grimoire-reduce-motion",
  confirmRenameLinks: "grimoire-confirm-rename-links",
};

/** The example world's banner went in the 2026-10 design review; its old key is
 *  only cleared away. */
const RETIRED_KEYS = ["grimoire-sample-banner-dismissed"];

function createAppPrefs() {
  let motionChoice = $state<MotionChoice>("system");
  // Followed live: a GM who changes their computer's setting mid-session sees it here.
  const systemReducesMotion = new MediaQuery("(prefers-reduced-motion: reduce)");
  const reduceMotion = $derived(
    motionChoice === "on" || (motionChoice === "system" && systemReducesMotion.current),
  );
  let confirmRenameLinks = $state(false);
  /**
   * How tight the app is drawn, everywhere. It was saved per world, so each world opened
   * at whatever density it had been left in (2026-10 design review: density is about the
   * GM's screen, accent about the world). Null until chosen, so the first world opened
   * can hand over the density it already had — see `adoptDensity`.
   */
  let density = $state<DensityLevel | null>(null);
  let loaded = false;

  function snapshot(): AppPrefsData {
    return {
      reduceMotion: motionChoice === "on",
      reduceMotionChoice: motionChoice,
      confirmRenameLinks,
      density,
    };
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
      Exclude<keyof AppPrefsData, "density" | "reduceMotionChoice">,
      string,
    ][]) {
      const value = window.localStorage.getItem(key);
      if (value === null) continue;
      migrated = true;
      if (value === "true") {
        if (pref === "reduceMotion") motionChoice = "on";
        if (pref === "confirmRenameLinks") confirmRenameLinks = true;
      }
      window.localStorage.removeItem(key);
    }
    for (const key of RETIRED_KEYS) window.localStorage.removeItem(key);
    return migrated;
  }

  /**
   * Load persisted prefs from Rust. Called once at app startup.
   *
   * Reduce Motion follows the computer ("system") unless the GM has chosen. A file from
   * before the choice had three answers keeps an "on" as on; its "off" was usually the
   * default, so it becomes "system", which is the same unless the computer asks for
   * reduced motion.
   */
  async function load(): Promise<void> {
    if (loaded) return;
    loaded = true;
    try {
      const saved = await api.getAppPrefs();
      if (saved) {
        motionChoice =
          asMotionChoice(saved.reduceMotionChoice) ?? (saved.reduceMotion ? "on" : "system");
        confirmRenameLinks = saved.confirmRenameLinks ?? false;
        density = asDensity(saved.density) ?? density;
      }
      const migrated = migrateLegacyKeys();
      if (migrated) {
        persist();
      }
    } catch (e) {
      console.error("[app-prefs] failed to load app prefs:", e);
    }
  }

  function setMotionChoice(choice: MotionChoice) {
    motionChoice = choice;
    persist();
  }

  /** On or off by choice — the old switch's two answers. */
  function setReduceMotion(value: boolean) {
    setMotionChoice(value ? "on" : "off");
  }

  function setConfirmRenameLinks(value: boolean) {
    confirmRenameLinks = value;
    persist();
  }

  function setDensity(level: DensityLevel) {
    density = level;
    persist();
  }

  /**
   * A world's own density from before it was app-wide, taken the once — so a GM who had
   * chosen Dense does not find the app suddenly Balanced. Ignored once a density is set.
   */
  function adoptDensity(level: unknown) {
    const adopted = asDensity(level);
    if (density !== null || !adopted) return;
    density = adopted;
    persist();
  }

  return {
    /** Whether motion is reduced now — the choice, or the computer's while it follows it. */
    get reduceMotion() {
      return reduceMotion;
    },
    get motionChoice(): MotionChoice {
      return motionChoice;
    },
    setMotionChoice,
    setReduceMotion,
    get confirmRenameLinks() {
      return confirmRenameLinks;
    },
    setConfirmRenameLinks,
    /** The app's density; Balanced until one is chosen. */
    get density(): DensityLevel {
      return density ?? "balanced";
    },
    setDensity,
    adoptDensity,
    load,
  };
}

export const appPrefs = createAppPrefs();
