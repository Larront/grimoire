import { createSubscriber } from "svelte/reactivity";
import { overlay, type RightRailPanel } from "$lib/stores/overlay.svelte.js";

/**
 * The pane width at which a [[Details Pane]] stops floating and docks to the
 * pane's right edge (ADR-0006 §2). Measured on the *pane*, never the window: a
 * half-width pane on an ultrawide is a narrow pane, and a media query would
 * dock a 300px rail into it and leave the editor unusable.
 */
export const DOCK_THRESHOLD = 820;

/** How a pane presents its detail surface at the width it currently has. */
export type SurfaceMode = "docked" | "floating" | "sheet";

export interface SurfacePolicy {
  /**
   * The pane offers a user toggle for its surface, so its header row shows one
   * (ADR-0006 §3). Notes do; a map's panels open by selecting a pin or an
   * annotation, so a map claims a surface with no toggle.
   */
  toggleable: boolean;
  /**
   * The surface floats at any width — the map policy. Docking would shrink the
   * canvas and a sheet would swallow it, and neither is acceptable for a map
   * the GM is reading spatially (ADR-0006 §2).
   */
  alwaysFloat: boolean;
}

/**
 * A media query read live rather than captured.
 *
 * `svelte/reactivity`'s `MediaQuery` calls `window.matchMedia` in its
 * constructor and answers from that one list forever. These surfaces are
 * created once per pane slot at module load, so a captured list would freeze
 * whatever `matchMedia` looked like at import time — which in a test is the
 * default stub, not the one the test installed. Re-reading per access costs a
 * `matchMedia` call and keeps the answer honest; the subscription is only there
 * so an effect re-runs when the query flips.
 */
class LiveMediaQuery {
  #query: string;
  #subscribe: () => void;

  constructor(query: string) {
    this.#query = query;
    this.#subscribe = createSubscriber((update) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", update);
      return () => list.removeEventListener("change", update);
    });
  }

  get current(): boolean {
    this.#subscribe();
    return window.matchMedia(this.#query).matches;
  }
}

/**
 * One pane's detail surface: what it measures, how it presents, and whether it
 * is showing.
 *
 * ADR-0006 §1 makes the surface pane-local — there is no app-level singleton and
 * no follows-focus arbitration. This module is the *state* half of that: the
 * pane's width, the dock/float/sheet decision derived from it, the visibility
 * latch, the mobile overlay token, and the float transition. `DetailSurface.svelte`
 * is the chrome half. Between them, "maps always float" is a policy argument
 * rather than a second implementation.
 *
 * It lives one level above the pane's *content*: a pane slot keeps its surface
 * while tabs come and go inside it, which is what lets a rail the GM opened stay
 * open as they navigate from note to note (and reappear on the way back from a
 * map). The content claims it on mount and releases it on unmount.
 */
export class PaneDetailSurface {
  #token: RightRailPanel;
  #isMobile = new LiveMediaQuery("(max-width: 1023px)");
  #reducedMotion = new LiveMediaQuery("(prefers-reduced-motion: reduce)");
  #width = $state(0);
  #policy = $state<SurfacePolicy | null>(null);
  #claimant: symbol | null = null;

  /** The desktop latch. The sheet's latch is the overlay token — see `openMobile`. */
  open = $state(false);

  constructor(pane: "left" | "right") {
    this.#token = `right-rail:${pane}`;
  }

  /**
   * The pane's content declares what surface it has. Returns its release.
   *
   * Claims carry a token because mount order across a content swap is not
   * guaranteed: if the outgoing pane releases *after* the incoming one has
   * claimed, a token-less release would withdraw a live claim and the toggle
   * would vanish until the next mount.
   */
  claim(policy: SurfacePolicy): () => void {
    const id = Symbol();
    this.#claimant = id;
    this.#policy = policy;
    return () => {
      if (this.#claimant !== id) return;
      this.#claimant = null;
      this.#policy = null;
      // Forget the width with the claim. A measurement outlives only the content
      // that took it: an always-float pane never measures at all, so a note
      // returning to a pane that has since been split would otherwise dock a
      // 300px rail from the old full-width reading for the frame before its own
      // observer reports.
      this.#width = 0;
    };
  }

  /**
   * Watch a pane container's width. Returns its teardown.
   *
   * A `ResizeObserver` and not a media query, and on the pane's own container:
   * window resize, opening a split and closing one all change a pane's width,
   * and the observer sees each of them. ADR-0006's *Amendments* note that a
   * draggable divider would be one more such event and need nothing new here.
   */
  measure(el: Element): () => void {
    const observer = new ResizeObserver((entries) => {
      this.#width = entries[0]?.contentRect.width ?? 0;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }

  /** Whether the pane's header row should offer a toggle at all. */
  get toggleable(): boolean {
    return this.#policy?.toggleable ?? false;
  }

  /**
   * Whether this surface floats over a host that stacks above the ordinary flow.
   * Only the always-float policy has one — Leaflet puts its own panes at z 400–700
   * — and that host isolates, so the layer the floating chrome needs to clear
   * them stays inside the pane. A note pane isolates nothing, so its float must
   * stay under the app's modals; see `DetailSurface.svelte`.
   */
  get overStackedHost(): boolean {
    return this.#policy?.alwaysFloat === true;
  }

  get mode(): SurfaceMode {
    if (this.#policy?.alwaysFloat) return "floating";
    if (this.#isMobile.current) return "sheet";
    return this.#width >= DOCK_THRESHOLD ? "docked" : "floating";
  }

  /**
   * Whether the measured width can be trusted yet. A floating surface rendered
   * before the observer's first callback flashes in at width 0 and then jumps to
   * docked. An always-float surface has nothing to wait for.
   */
  get ready(): boolean {
    return this.#policy?.alwaysFloat === true || this.#width > 0;
  }

  get isMobile(): boolean {
    return this.#isMobile.current;
  }

  /**
   * The overlay store *is* the sheet's latch, not a mirror of one.
   *
   * A separate internal boolean desynced from `overlay.active` the moment the
   * other pane's sheet took the token: the closed pane still believed itself
   * open, so its next press closed an already-closed sheet and the GM had to
   * press twice (#200). With a token per pane, `overlay.active` is the single
   * place a sheet's open-ness lives, and mutual exclusion falls out of it.
   */
  get openMobile(): boolean {
    return overlay.active === this.#token;
  }

  setOpenMobile = (value: boolean) => {
    if (value) overlay.request(this.#token);
    else overlay.release(this.#token);
  };

  /** The latch that governs the mode this surface is currently in. */
  get visible(): boolean {
    return this.mode === "sheet" ? this.openMobile : this.open;
  }

  toggle = () => {
    if (this.mode === "sheet") this.setOpenMobile(!this.openMobile);
    else this.open = !this.open;
  };

  /** `fly` parameters for the floating chrome. Reduced motion snaps (ADR-0006). */
  get transition(): { x: number; duration: number } {
    return { x: 200, duration: this.#reducedMotion.current ? 0 : 150 };
  }

  /** Test seam — see `resetPaneSurfaces`. */
  reset(): void {
    this.open = false;
    this.#width = 0;
    this.#policy = null;
    this.#claimant = null;
    this.setOpenMobile(false);
  }
}

// One per pane slot, created eagerly so no component owns them: the tab model has
// at most two panes (`tabs.svelte.ts`), and a surface must outlive the content
// mounted in its slot.
const surfaces = {
  left: new PaneDetailSurface("left"),
  right: new PaneDetailSurface("right"),
} as const;

export function paneSurface(pane: "left" | "right"): PaneDetailSurface {
  return surfaces[pane];
}

/**
 * Return both panes' surfaces to their initial state. Module-level state
 * persists for a test file's lifetime, so a test that opens a rail would
 * otherwise hand the next one an already-open surface.
 */
export function resetPaneSurfaces(): void {
  surfaces.left.reset();
  surfaces.right.reset();
}
