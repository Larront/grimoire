export type TabType = "note" | "map" | "scene" | "scenes" | "empty";

export interface PersistedTab {
  type: TabType;
  id: number;
  title: string;
}

export interface PersistedPane {
  tabs: PersistedTab[];
  activeIndex: number;
}

export interface PersistedState {
  left: PersistedPane;
  right: PersistedPane | null;
  focusedPane: "left" | "right";
}

export interface TabPersistence {
  save(state: PersistedState): void;
  load(): PersistedState | null;
}

export class LocalStorageTabPersistence implements TabPersistence {
  private readonly key: string;

  constructor(vaultPath: string) {
    this.key = `grimoire:tabs:${vaultPath}`;
  }

  save(state: PersistedState): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(state));
    } catch {}
  }

  load(): PersistedState | null {
    const raw = localStorage.getItem(this.key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PersistedState;
    } catch {
      return null;
    }
  }
}
