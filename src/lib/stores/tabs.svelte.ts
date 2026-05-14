import { untrack } from "svelte";
import { vault } from "./vault.svelte";
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
}

export interface TabPane {
  tabs: Tab[];
  activeIndex: number;
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
        .map((t) => ({ type: t.type, id: t.id, title: t.title }));
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

  function openTab(tab: Tab, targetPane?: "left" | "right") {
    // Switch to existing tab if already open
    const leftIdx = left.tabs.findIndex(
      (t) => t.type === tab.type && t.id === tab.id,
    );
    if (leftIdx !== -1) {
      left = { ...left, activeIndex: leftIdx };
      focusedPane = "left";
      persist();
      return;
    }
    if (right) {
      const rightIdx = right.tabs.findIndex(
        (t) => t.type === tab.type && t.id === tab.id,
      );
      if (rightIdx !== -1) {
        right = { ...right, activeIndex: rightIdx };
        focusedPane = "right";
        persist();
        return;
      }
    }

    const dest = targetPane ?? focusedPane;
    const newTab: Tab = {
      type: tab.type,
      id: tab.id,
      title: tab.title,
      rename: tab.rename,
    };

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

  function setDragging(
    value: { pane: "left" | "right"; index: number } | null,
  ) {
    dragging = value;
  }

  $effect.root(() => {
    $effect(() => {
      if (vault.isOpen && vault.path) {
        persistence = new LocalStorageTabPersistence(vault.path);
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
    clearRenameFlag,
    setFocusedPane,
    isTabOpen,
    setDragging,
  };
}

export const tabs = createTabsStore();
