import { untrack } from "svelte";
import { ledger } from "./ledger.svelte";
import { maps } from "./maps.svelte";
import {
  LocalStorageTabPersistence,
  type TabPersistence,
  type PersistedState,
  type TabType,
} from "./tab-persistence";

export type { TabType } from "./tab-persistence";

export interface Tab {
  type: TabType;
  id: number;
  title: string;
  rename?: boolean;
  badge?: string;
  templatePath?: string;
}

export interface TabPane {
  tabs: Tab[];
  activeIndex: number;
  backStack?: Tab[];
  forwardStack?: Tab[];
}

function createTabsStore() {
  let left = $state<TabPane>({ tabs: [], activeIndex: 0 });
  let right = $state<TabPane | null>(null);
  let focusedPane = $state<"left" | "right">("left");
  let dragging = $state<{ pane: "left" | "right"; index: number } | null>(null);
  let _nextEmptyId = 0;
  let persistence: TabPersistence | null = null;

  function buildState(): PersistedState {
    const serializeTabs = (tabs: Tab[]) =>
      tabs
        .filter((t) => t.type !== "empty")
        .map((t) => ({
          type: t.type,
          id: t.id,
          title: t.title,
          ...(t.templatePath ? { templatePath: t.templatePath } : {}),
        }));
    const leftTabs = serializeTabs(left.tabs);
    const rightTabs = right ? serializeTabs(right.tabs) : null;
    return {
      left: {
        tabs: leftTabs,
        activeIndex: Math.min(left.activeIndex, Math.max(0, leftTabs.length - 1)),
      },
      right: right && rightTabs
        ? {
            tabs: rightTabs,
            activeIndex: Math.min(right.activeIndex, Math.max(0, rightTabs.length - 1)),
          }
        : null,
      focusedPane,
    };
  }

  function persist() {
    untrack(() => persistence?.save(buildState()));
  }

  function reset() {
    left = { tabs: [], activeIndex: 0 };
    right = null;
    focusedPane = "left";
    dragging = null;
  }

  function tabMatches(t: Tab, tab: Tab): boolean {
    if (tab.type === "template") return t.type === "template" && t.templatePath === tab.templatePath;
    return t.type === tab.type && t.id === tab.id;
  }

  function openTab(tab: Tab, targetPane?: "left" | "right") {
    // Switch to existing tab if already open
    const leftIdx = left.tabs.findIndex((t) => tabMatches(t, tab));
    if (leftIdx !== -1) {
      left = { ...left, activeIndex: leftIdx };
      focusedPane = "left";
      persist();
      return;
    }
    if (right) {
      const rightIdx = right.tabs.findIndex((t) => tabMatches(t, tab));
      if (rightIdx !== -1) {
        right = { ...right, activeIndex: rightIdx };
        focusedPane = "right";
        persist();
        return;
      }
    }

    const dest = targetPane ?? focusedPane;
    const newTab: Tab = { ...tab };

    if (dest === "right") {
      if (!right || right.tabs.length === 0) {
        right = { tabs: [newTab], activeIndex: 0 };
      } else {
        const tabs = [...right.tabs];
        tabs[right.activeIndex] = newTab;
        right = { ...right, tabs };
      }
      focusedPane = "right";
    } else {
      if (left.tabs.length === 0) {
        left = { tabs: [newTab], activeIndex: 0 };
      } else {
        const tabs = [...left.tabs];
        tabs[left.activeIndex] = newTab;
        left = { ...left, tabs };
      }
      focusedPane = "left";
    }
    persist();
  }

  function addEmptyTab(pane: "left" | "right") {
    const newTab: Tab = { type: "empty", id: --_nextEmptyId, title: "New Tab" };
    if (pane === "right") {
      if (!right) {
        right = { tabs: [newTab], activeIndex: 0 };
      } else {
        right = { tabs: [...right.tabs, newTab], activeIndex: right.tabs.length };
      }
      focusedPane = "right";
    } else {
      left = { tabs: [...left.tabs, newTab], activeIndex: left.tabs.length };
      focusedPane = "left";
    }
    persist();
  }

  function openTabWithRename(type: TabType, id: number, title: string) {
    const leftIdx = left.tabs.findIndex((t) => t.type === type && t.id === id);
    if (leftIdx !== -1) {
      const tabs = [...left.tabs];
      tabs[leftIdx] = { ...tabs[leftIdx], rename: true };
      left = { tabs, activeIndex: leftIdx };
      focusedPane = "left";
      persist();
      return;
    }
    if (right) {
      const rightIdx = right.tabs.findIndex(
        (t) => t.type === type && t.id === id,
      );
      if (rightIdx !== -1) {
        const tabs = [...right.tabs];
        tabs[rightIdx] = { ...tabs[rightIdx], rename: true };
        right = { tabs, activeIndex: rightIdx };
        focusedPane = "right";
        persist();
        return;
      }
    }
    openTab({ type, id, title, rename: true });
  }

  function closeTab(pane: "left" | "right", index: number) {
    const closing = (pane === "right" ? right?.tabs : left.tabs)?.[index] ?? null;
    if (pane === "right") {
      if (!right) return;
      const tabs = [...right.tabs];
      tabs.splice(index, 1);
      if (tabs.length === 0) {
        right = null;
        focusedPane = "left";
      } else {
        right = {
          tabs,
          activeIndex: Math.min(right.activeIndex, tabs.length - 1),
        };
      }
    } else {
      const tabs = [...left.tabs];
      tabs.splice(index, 1);
      left = {
        tabs,
        activeIndex:
          tabs.length === 0 ? 0 : Math.min(left.activeIndex, tabs.length - 1),
      };
    }
    persist();
    // A map closed before an image was assigned is an abandoned creation —
    // remove its DB row. Skip if the same map is still open in the other pane.
    if (closing?.type === "map" && !isTabOpen("map", closing.id)) {
      maps.pruneIfImageless(closing.id);
    }
  }

  function closeOthers(pane: "left" | "right", index: number) {
    if (pane === "right") {
      if (!right || !right.tabs[index]) return;
      right = { tabs: [right.tabs[index]], activeIndex: 0 };
    } else {
      if (!left.tabs[index]) return;
      left = { tabs: [left.tabs[index]], activeIndex: 0 };
    }
    persist();
  }

  function closeAll(pane: "left" | "right") {
    if (pane === "right") {
      right = null;
      focusedPane = "left";
    } else {
      left = { tabs: [], activeIndex: 0 };
    }
    persist();
  }

  function activateTab(pane: "left" | "right", index: number) {
    if (pane === "right") {
      if (!right || index >= right.tabs.length) return;
      right = { ...right, activeIndex: index };
    } else {
      if (index >= left.tabs.length) return;
      left = { ...left, activeIndex: index };
    }
    focusedPane = pane;
    persist();
  }

  function reorderTab(
    pane: "left" | "right",
    fromIndex: number,
    toIndex: number,
  ) {
    if (fromIndex === toIndex) return;
    if (pane === "right") {
      if (!right) return;
      const tabs = [...right.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, moved);
      let ai = right.activeIndex;
      if (ai === fromIndex) ai = toIndex;
      else if (fromIndex < ai && toIndex >= ai) ai--;
      else if (fromIndex > ai && toIndex <= ai) ai++;
      right = { tabs, activeIndex: ai };
    } else {
      const tabs = [...left.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, moved);
      let ai = left.activeIndex;
      if (ai === fromIndex) ai = toIndex;
      else if (fromIndex < ai && toIndex >= ai) ai--;
      else if (fromIndex > ai && toIndex <= ai) ai++;
      left = { tabs, activeIndex: ai };
    }
    persist();
  }

  function moveToOtherPane(fromPane: "left" | "right", tabIndex: number) {
    const source = fromPane === "left" ? left : right;
    if (!source || !source.tabs[tabIndex]) return;
    const tab = source.tabs[tabIndex];
    const srcTabs = [...source.tabs];
    srcTabs.splice(tabIndex, 1);
    const srcActive = Math.min(
      source.activeIndex,
      Math.max(0, srcTabs.length - 1),
    );

    if (fromPane === "left") {
      left = { tabs: srcTabs, activeIndex: srcActive };
      if (!right) {
        right = { tabs: [tab], activeIndex: 0 };
      } else {
        right = { tabs: [...right.tabs, tab], activeIndex: right.tabs.length };
      }
      focusedPane = "right";
    } else {
      right =
        srcTabs.length === 0 ? null : { tabs: srcTabs, activeIndex: srcActive };
      if (right === null) focusedPane = "left";
      left = { tabs: [...left.tabs, tab], activeIndex: left.tabs.length };
      focusedPane = "left";
    }
    persist();
  }

  function closeActiveTab() {
    const target = focusedPane === "left" ? left : right;
    if (!target || target.tabs.length === 0) return;
    closeTab(focusedPane, target.activeIndex);
  }

  function closeTabByTypeAndId(type: TabType, id: number) {
    const leftIdx = left.tabs.findIndex((t) => t.type === type && t.id === id);
    if (leftIdx !== -1) {
      closeTab("left", leftIdx);
      return;
    }
    if (right) {
      const rightIdx = right.tabs.findIndex(
        (t) => t.type === type && t.id === id,
      );
      if (rightIdx !== -1) closeTab("right", rightIdx);
    }
  }

  function updateTabTitle(type: TabType, id: number, title: string) {
    const update = (pane: TabPane) => ({
      ...pane,
      tabs: pane.tabs.map((t) =>
        t.type === type && t.id === id ? { ...t, title } : t,
      ),
    });
    left = update(left);
    if (right) right = update(right);
    persist();
  }

  function updateTemplateTab(oldPath: string, newTitle: string, newPath: string) {
    const update = (pane: TabPane) => ({
      ...pane,
      tabs: pane.tabs.map((t) =>
        t.type === "template" && t.templatePath === oldPath
          ? { ...t, title: newTitle, templatePath: newPath }
          : t,
      ),
    });
    left = update(left);
    if (right) right = update(right);
    persist();
  }

  function clearRenameFlag(pane: "left" | "right", index: number) {
    if (pane === "right") {
      if (!right?.tabs[index]) return;
      const tabs = [...right.tabs];
      tabs[index] = { ...tabs[index], rename: undefined };
      right = { ...right, tabs };
    } else {
      if (!left.tabs[index]) return;
      const tabs = [...left.tabs];
      tabs[index] = { ...tabs[index], rename: undefined };
      left = { ...left, tabs };
    }
  }

  function setFocusedPane(pane: "left" | "right") {
    if (pane === "right" && !right) return;
    focusedPane = pane;
  }

  function isTabOpen(type: TabType, id: number): boolean {
    return (
      left.tabs.some((t) => t.type === type && t.id === id) ||
      (right?.tabs.some((t) => t.type === type && t.id === id) ?? false)
    );
  }

  function openTabForceNew(tab: Tab, targetPane?: "left" | "right") {
    const dest = targetPane ?? focusedPane;
    const newTab: Tab = { ...tab };
    if (dest === "right") {
      const existing = right?.tabs ?? [];
      right = { tabs: [...existing, newTab], activeIndex: existing.length };
      focusedPane = "right";
    } else {
      left = { tabs: [...left.tabs, newTab], activeIndex: left.tabs.length };
      focusedPane = "left";
    }
    persist();
  }

  function openTabOpposite(tab: Tab) {
    const opposite: "left" | "right" = focusedPane === "left" ? "right" : "left";
    const newTab: Tab = { ...tab };
    if (opposite === "right") {
      if (!right) {
        right = { tabs: [newTab], activeIndex: 0 };
      } else {
        const idx = right.tabs.findIndex((t) => t.type === tab.type && t.id === tab.id);
        if (idx !== -1) {
          right = { ...right, activeIndex: idx };
        } else {
          right = { tabs: [...right.tabs, newTab], activeIndex: right.tabs.length };
        }
      }
    } else {
      const idx = left.tabs.findIndex((t) => t.type === tab.type && t.id === tab.id);
      if (idx !== -1) {
        left = { ...left, activeIndex: idx };
      } else {
        left = { tabs: [...left.tabs, newTab], activeIndex: left.tabs.length };
      }
    }
    persist();
  }

  function pushNavHistory(pane: "left" | "right") {
    const current = pane === "left" ? left : right;
    if (!current) return;
    const currentTab = current.tabs[current.activeIndex];
    if (!currentTab || currentTab.type === "empty") return;
    const backStack = [...(current.backStack ?? []), currentTab];
    if (pane === "right") {
      right = { ...current, backStack, forwardStack: [] };
    } else {
      left = { ...current, backStack, forwardStack: [] };
    }
  }

  function navigate(tab: Tab) {
    const pane = focusedPane;
    const current = pane === "right" && right ? right : left;
    const currentTab = current.tabs[current.activeIndex];
    const newTab: Tab = { type: tab.type, id: tab.id, title: tab.title, badge: tab.badge, templatePath: tab.templatePath };
    const newTabs = [...current.tabs];
    newTabs[current.activeIndex] = newTab;
    const backStack = currentTab && currentTab.type !== "empty"
      ? [...(current.backStack ?? []), currentTab]
      : (current.backStack ?? []);
    if (pane === "right" && right) {
      right = { ...right, tabs: newTabs, backStack, forwardStack: [] };
    } else {
      left = { ...left, tabs: newTabs, backStack, forwardStack: [] };
    }
    persist();
  }

  function navigateOpen(tab: Tab, targetPane?: "left" | "right") {
    pushNavHistory(targetPane ?? focusedPane);
    openTab(tab, targetPane);
  }

  function applyHistoryEntry(pane: "left" | "right", entry: Tab, backStack: Tab[], forwardStack: Tab[]) {
    const current = pane === "left" ? left : right;
    if (!current) return;
    const existingIdx = current.tabs.findIndex((t) => t.type === entry.type && t.id === entry.id);
    const newTabs = [...current.tabs];
    const newActiveIndex = existingIdx !== -1 ? existingIdx : current.activeIndex;
    if (existingIdx === -1) newTabs[current.activeIndex] = entry;
    if (pane === "right") {
      right = { ...current, tabs: newTabs, activeIndex: newActiveIndex, backStack, forwardStack };
    } else {
      left = { ...current, tabs: newTabs, activeIndex: newActiveIndex, backStack, forwardStack };
    }
    persist();
  }

  function navigateBack(pane: "left" | "right") {
    const current = pane === "left" ? left : right;
    if (!current || !(current.backStack ?? []).length) return;
    const backStack = [...(current.backStack ?? [])];
    const prev = backStack.pop()!;
    const currentTab = current.tabs[current.activeIndex];
    const forwardStack = currentTab
      ? [currentTab, ...(current.forwardStack ?? [])]
      : (current.forwardStack ?? []);
    applyHistoryEntry(pane, prev, backStack, forwardStack);
  }

  function navigateForward(pane: "left" | "right") {
    const current = pane === "left" ? left : right;
    if (!current || !(current.forwardStack ?? []).length) return;
    const forwardStack = [...(current.forwardStack ?? [])];
    const next = forwardStack.shift()!;
    const currentTab = current.tabs[current.activeIndex];
    const backStack = currentTab
      ? [...(current.backStack ?? []), currentTab]
      : (current.backStack ?? []);
    applyHistoryEntry(pane, next, backStack, forwardStack);
  }

  function setDragging(
    value: { pane: "left" | "right"; index: number } | null,
  ) {
    dragging = value;
  }

  $effect.root(() => {
    $effect(() => {
      if (ledger.isOpen && ledger.path) {
        persistence = new LocalStorageTabPersistence(ledger.path);
        const saved = persistence.load();
        if (saved) {
          left = saved.left ?? { tabs: [], activeIndex: 0 };
          right = saved.right ?? null;
          focusedPane = saved.focusedPane ?? "left";
        } else {
          reset();
        }
      } else {
        persistence = null;
        reset();
      }
    });
  });

  return {
    get left() {
      return left;
    },
    get right() {
      return right;
    },
    get focusedPane() {
      return focusedPane;
    },
    get dragging() {
      return dragging;
    },
    get leftActiveTab() {
      return left.tabs[left.activeIndex] ?? null;
    },
    get rightActiveTab() {
      return right ? (right.tabs[right.activeIndex] ?? null) : null;
    },
    get activeTab() {
      return focusedPane === "left"
        ? (left.tabs[left.activeIndex] ?? null)
        : right
          ? (right.tabs[right.activeIndex] ?? null)
          : null;
    },
    canGoBack(pane: "left" | "right") {
      const current = pane === "left" ? left : right;
      return (current?.backStack?.length ?? 0) > 0;
    },
    canGoForward(pane: "left" | "right") {
      const current = pane === "left" ? left : right;
      return (current?.forwardStack?.length ?? 0) > 0;
    },
    openTab,
    addEmptyTab,
    openTabWithRename,
    closeTab,
    closeOthers,
    closeAll,
    activateTab,
    reorderTab,
    moveToOtherPane,
    closeActiveTab,
    closeTabByTypeAndId,
    updateTabTitle,
    updateTemplateTab,
    clearRenameFlag,
    setFocusedPane,
    isTabOpen,
    setDragging,
    openTabForceNew,
    openTabOpposite,
    navigate,
    navigateOpen,
    navigateBack,
    navigateForward,
  };
}

export const tabs = createTabsStore();
