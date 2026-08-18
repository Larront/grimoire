import { IsMobile } from "$lib/hooks/is-mobile.svelte.js";
import { overlay, type RightRailPanel } from "./overlay.svelte.js";

export class RightRailState {
  #isMobile: IsMobile;
  #token: RightRailPanel;
  open = $state(false);

  constructor(pane: "left" | "right") {
    this.#token = `right-rail:${pane}`;
    this.#isMobile = new IsMobile(1024);
  }

  get isMobile() {
    return this.#isMobile.current;
  }

  /**
   * The overlay store *is* the latch, not a mirror of one.
   *
   * A separate internal boolean desynced from `overlay.active` the moment the
   * other pane's sheet took the token: the closed pane still believed itself
   * open, so its next press closed an already-closed sheet and the GM had to
   * press twice (#200). With a token per pane, `overlay.active` is the single
   * place a sheet's open-ness lives, and mutual exclusion falls out of it.
   *
   * A getter rather than a `$derived` field because the token is a constructor
   * argument — same reason `isMobile` is one.
   */
  get openMobile() {
    return overlay.active === this.#token;
  }

  setOpenMobile = (value: boolean) => {
    if (value) overlay.request(this.#token);
    else overlay.release(this.#token);
  };

  toggle = () => {
    if (this.#isMobile.current) {
      this.setOpenMobile(!this.openMobile);
    } else {
      this.open = !this.open;
    }
  };
}
