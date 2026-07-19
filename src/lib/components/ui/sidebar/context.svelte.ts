import { IsMobile } from "$lib/hooks/is-mobile.svelte.js";
import { overlay } from "$lib/stores/overlay.svelte.js";
import { getContext, setContext } from "svelte";
import {
  SIDEBAR_KEYBOARD_SHORTCUT,
  SIDEBAR_WIDTH_DEFAULT_PX,
  SIDEBAR_WIDTH_MAX_PX,
  SIDEBAR_WIDTH_MIN_PX,
  SIDEBAR_WIDTH_STORAGE_KEY,
} from "./constants.js";

function clampSidebarWidth(px: number): number {
  return Math.min(SIDEBAR_WIDTH_MAX_PX, Math.max(SIDEBAR_WIDTH_MIN_PX, px));
}

type Getter<T> = () => T;

export type SidebarStateProps = {
  /**
   * A getter function that returns the current open state of the sidebar.
   * We use a getter function here to support `bind:open` on the `Sidebar.Provider`
   * component.
   */
  open: Getter<boolean>;

  /**
   * A function that sets the open state of the sidebar. To support `bind:open`, we need
   * a source of truth for changing the open state to ensure it will be synced throughout
   * the sub-components and any `bind:` references.
   */
  setOpen: (open: boolean) => void;
};

class SidebarState {
  readonly props: SidebarStateProps;
  open = $derived.by(() => this.props.open());
  // openMobile is false when another overlay panel is active (mutual exclusion)
  #openMobileInternal = $state(false);
  openMobile = $derived.by(
    () => this.#openMobileInternal && overlay.active === "sidebar",
  );
  setOpen: SidebarStateProps["setOpen"];
  #isMobile: IsMobile;
  state = $derived.by(() => (this.open ? "expanded" : "collapsed"));

  // Drag-to-resize width (px) for the expanded desktop sidebar, restored from
  // localStorage. `resizing` suppresses the width transition mid-drag so the
  // edge tracks the pointer instead of lagging behind it.
  #width = $state(SIDEBAR_WIDTH_DEFAULT_PX);
  #resizing = $state(false);

  constructor(props: SidebarStateProps) {
    this.setOpen = props.setOpen;
    this.#isMobile = new IsMobile(1024);
    this.props = props;

    if (typeof localStorage !== "undefined") {
      const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
      if (Number.isFinite(saved) && saved > 0) {
        this.#width = clampSidebarWidth(saved);
      }
    }
  }

  get width() {
    return this.#width;
  }

  get resizing() {
    return this.#resizing;
  }

  setResizing = (value: boolean) => {
    this.#resizing = value;
  };

  // Live update during a drag (not persisted); call persistWidth() on release.
  setWidth = (px: number) => {
    this.#width = clampSidebarWidth(px);
  };

  persistWidth = () => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(this.#width));
    } catch {
      // Storage disabled/full — the width just won't survive a restart.
    }
  };

  // Convenience getter for checking if the sidebar is mobile
  // without this, we would need to use `sidebar.isMobile.current` everywhere
  get isMobile() {
    return this.#isMobile.current;
  }

  handleShortcutKeydown = (e: KeyboardEvent) => {
    if (e.key === SIDEBAR_KEYBOARD_SHORTCUT && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      this.toggle();
    }
  };

  setOpenMobile = (value: boolean) => {
    this.#openMobileInternal = value;
    if (value) overlay.request("sidebar");
    else overlay.release("sidebar");
  };

  toggle = () => {
    return this.#isMobile.current
      ? this.setOpenMobile(!this.#openMobileInternal)
      : this.setOpen(!this.open);
  };
}

const SYMBOL_KEY = "scn-sidebar";

/**
 * Instantiates a new `SidebarState` instance and sets it in the context.
 *
 * @param props The constructor props for the `SidebarState` class.
 * @returns  The `SidebarState` instance.
 */
export function setSidebar(props: SidebarStateProps): SidebarState {
  return setContext(Symbol.for(SYMBOL_KEY), new SidebarState(props));
}

/**
 * Retrieves the `SidebarState` instance from the context. This is a class instance,
 * so you cannot destructure it.
 * @returns The `SidebarState` instance.
 */
export function useSidebar(): SidebarState {
  return getContext(Symbol.for(SYMBOL_KEY));
}
