import { render, waitFor, cleanup, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import GraphPane from "../lib/components/panes/GraphPane.svelte";
import { tabs } from "../lib/stores/tabs.svelte";

// ── Cytoscape mock ─────────────────────────────────────────────────────────────
// JSDOM has no canvas; mock cytoscape so the component mounts without errors.
// The mock records the options it was called with and provides a tap listener
// registry so tests can fire synthetic node-click events.
// mockStyleFn records cy.style([...]) calls so re-apply tests can verify.
// Node and edge mocks support style() so visibility tests can verify display changes.

type TapHandler = (e: { target: MockNode }) => void;
interface MockNode {
  data(key: string): unknown;
}

type CyNode = {
  data: (key?: string, val?: unknown) => unknown;
  style: (key?: string, val?: unknown) => unknown;
};
type CyEdge = {
  data: (key?: string, val?: unknown) => unknown;
  style: (key?: string, val?: unknown) => unknown;
  source: () => CyNode;
  target: () => CyNode;
};

const tapHandlers: TapHandler[] = [];
let cytoscapeOptions: unknown = null;
let mockNodes: CyNode[] = [];
let mockEdges: CyEdge[] = [];
const mockFit = vi.fn();
const mockDestroy = vi.fn();
const mockStyleFn = vi.fn();
// Per-node style stores: maps node id → { display: ..., ... }
const nodeStyleStores = new Map<string, Record<string, unknown>>();
const edgeStyleStores = new Map<string, Record<string, unknown>>();

vi.mock("cytoscape", () => {
  return {
    default: vi.fn((opts: unknown) => {
      cytoscapeOptions = opts;
      // Build mock node objects from the options so data-update tests work
      const typedOpts = opts as {
        elements?: {
          nodes?: Array<{ data: Record<string, unknown> }>;
          edges?: Array<{ data: Record<string, unknown> }>;
        };
      };
      const nodeDataArr = typedOpts.elements?.nodes ?? [];
      const edgeDataArr = typedOpts.elements?.edges ?? [];

      nodeStyleStores.clear();
      edgeStyleStores.clear();

      const nodeMap = new Map<string, CyNode>();

      const nodeStore = nodeDataArr.map((n) => {
        const store: Record<string, unknown> = { ...n.data };
        const styles: Record<string, unknown> = {};
        const id = n.data.id as string;
        nodeStyleStores.set(id, styles);
        const node: CyNode = {
          data: (key?: string, val?: unknown) => {
            if (val !== undefined && key !== undefined) { store[key] = val; return undefined; }
            if (key !== undefined) return store[key];
            return store;
          },
          style: (key?: string, val?: unknown) => {
            if (val !== undefined && key !== undefined) { styles[key] = val; return undefined; }
            if (key !== undefined) return styles[key];
            return styles;
          },
        };
        nodeMap.set(id, node);
        return node;
      });
      mockNodes = nodeStore;

      const edgeStore = edgeDataArr.map((e) => {
        const store: Record<string, unknown> = { ...e.data };
        const styles: Record<string, unknown> = {};
        const id = e.data.id as string;
        edgeStyleStores.set(id, styles);
        const edge: CyEdge = {
          data: (key?: string, val?: unknown) => {
            if (val !== undefined && key !== undefined) { store[key] = val; return undefined; }
            if (key !== undefined) return store[key];
            return store;
          },
          style: (key?: string, val?: unknown) => {
            if (val !== undefined && key !== undefined) { styles[key] = val; return undefined; }
            if (key !== undefined) return styles[key];
            return styles;
          },
          source: () => nodeMap.get(store.source as string) ?? nodeStore[0],
          target: () => nodeMap.get(store.target as string) ?? nodeStore[0],
        };
        return edge;
      });
      mockEdges = edgeStore;

      return {
        on: vi.fn((event: string, selector: string, handler: TapHandler) => {
          if (event === "tap") tapHandlers.push(handler);
        }),
        fit: mockFit,
        destroy: mockDestroy,
        style: mockStyleFn,
        nodes: () => ({
          forEach: (cb: (n: CyNode) => void) => nodeStore.forEach(cb),
        }),
        edges: () => ({
          forEach: (cb: (e: CyEdge) => void) => edgeStore.forEach(cb),
        }),
      };
    }),
  };
});

vi.mock("../lib/stores/tabs.svelte", () => ({
  tabs: {
    openTab: vi.fn(),
    get activeTab() { return null; },
  },
}));

vi.mock("../lib/stores/search.svelte", () => ({
  searchPalette: { open: false, activeQuery: "", settingsOpen: false },
}));

// ── Mock data ─────────────────────────────────────────────────────────────────
// Nodes now include primary_tag and backlink_count as the backend provides them.

const mockGraphData = {
  nodes: [
    { id: "note-1", label: "My Note",    kind: "note", entity_id: 1,  primary_tag: "npc",    backlink_count: 5 },
    { id: "note-2", label: "Other Note", kind: "note", entity_id: 2,  primary_tag: "quest",  backlink_count: 0 },
    { id: "note-3", label: "No Tag",     kind: "note", entity_id: 3,  primary_tag: null,     backlink_count: 2 },
    { id: "map-10", label: "World Map",  kind: "map",  entity_id: 10, primary_tag: null,     backlink_count: 0 },
    { id: "stub-unknown.md", label: "unknown.md", kind: "stub", primary_tag: null, backlink_count: 0 },
  ],
  edges: [
    { id: "e-0", source: "note-1", target: "note-2" },
    { id: "e-1", source: "note-1", target: "stub-unknown.md" },
    { id: "e-2", source: "map-10", target: "note-1" },
  ],
};

// "npc" has an explicit hex color; "quest" has null (auto-assign from accent cycle)
const mockTagStyles = {
  npc:   { color: "#ff0000", hidden: false },
  quest: { color: null,      hidden: false },
};

// Tags returned by list_all_tags
const mockAllTags = ["npc", "quest"];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** CSS stub: --foreground-muted returns a known test value */
const MUTED_COLOR = "#a39e99";

function mockComputedStyle() {
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: (prop: string) => {
      if (prop === "--foreground-muted") return MUTED_COLOR;
      return "";
    },
  } as unknown as CSSStyleDeclaration);
}

function setupInvoke() {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "get_graph_data") return Promise.resolve(mockGraphData);
    if (cmd === "get_tag_graph_styles") return Promise.resolve(mockTagStyles);
    if (cmd === "list_all_tags") return Promise.resolve(mockAllTags);
    if (cmd === "set_tag_graph_style") return Promise.resolve(null);
    return Promise.resolve(null);
  });
}

// ── Reset between tests ───────────────────────────────────────────────────────

beforeEach(() => {
  tapHandlers.length = 0;
  cytoscapeOptions = null;
  mockNodes = [];
  mockEdges = [];
  nodeStyleStores.clear();
  edgeStyleStores.clear();
  mockFit.mockClear();
  mockDestroy.mockClear();
  mockStyleFn.mockClear();
  vi.mocked(tabs.openTab).mockClear();
  setupInvoke();
  mockComputedStyle();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── Shell rendering ────────────────────────────────────────────────────────────

describe("GraphPane – shell", () => {
  it("renders the graph container element", () => {
    const { container } = render(GraphPane);
    expect(container.querySelector("[data-testid='graph-container']")).toBeTruthy();
  });

  it("calls get_graph_data on mount", async () => {
    render(GraphPane);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_graph_data");
    });
  });

  it("calls get_tag_graph_styles on mount", async () => {
    render(GraphPane);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_tag_graph_styles");
    });
  });

  it("calls list_all_tags on mount", async () => {
    render(GraphPane);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("list_all_tags");
    });
  });

  it("initialises cytoscape with cose layout after data loads", async () => {
    render(GraphPane);
    await waitFor(() => {
      expect(cytoscapeOptions).toBeTruthy();
      const opts = cytoscapeOptions as { layout: { name: string } };
      expect(opts.layout.name).toBe("cose");
    });
  });

  it("passes nodes and edges from get_graph_data to cytoscape", async () => {
    render(GraphPane);
    await waitFor(() => {
      const opts = cytoscapeOptions as {
        elements: {
          nodes: Array<{ data: unknown }>;
          edges: Array<{ data: unknown }>;
        };
      };
      expect(opts.elements.nodes).toHaveLength(5);
      expect(opts.elements.edges).toHaveLength(3);
    });
  });

  it("calls cy.fit() after layout completes", async () => {
    render(GraphPane);
    await waitFor(() => {
      expect(mockFit).toHaveBeenCalled();
    });
  });
});

// ── Node coloring ─────────────────────────────────────────────────────────────

describe("GraphPane – node tag coloring", () => {
  it("note with explicit tag color receives that color in element data", async () => {
    render(GraphPane);
    await waitFor(() => {
      const opts = cytoscapeOptions as { elements: { nodes: Array<{ data: Record<string, unknown> }> } };
      const note1 = opts.elements.nodes.find((n) => n.data.id === "note-1");
      // "npc" tag has color "#ff0000"
      expect(note1?.data.color).toBe("#ff0000");
    });
  });

  it("note with null-color tag receives the first accent cycle hex", async () => {
    render(GraphPane);
    await waitFor(() => {
      const opts = cytoscapeOptions as { elements: { nodes: Array<{ data: Record<string, unknown> }> } };
      const note2 = opts.elements.nodes.find((n) => n.data.id === "note-2");
      // "quest" tag has null color → gets first accent cycle color: #c2483d
      expect(note2?.data.color).toBe("#c2483d");
    });
  });

  it("untagged note receives the muted foreground color from CSS", async () => {
    render(GraphPane);
    await waitFor(() => {
      const opts = cytoscapeOptions as { elements: { nodes: Array<{ data: Record<string, unknown> }> } };
      const note3 = opts.elements.nodes.find((n) => n.data.id === "note-3");
      expect(note3?.data.color).toBe(MUTED_COLOR);
    });
  });

  it("map node receives fixed neutral color (not the muted foreground)", async () => {
    render(GraphPane);
    await waitFor(() => {
      const opts = cytoscapeOptions as { elements: { nodes: Array<{ data: Record<string, unknown> }> } };
      const map = opts.elements.nodes.find((n) => n.data.id === "map-10");
      expect(map?.data.color).toBeDefined();
      expect(map?.data.color).not.toBe(MUTED_COLOR);
      expect(typeof map?.data.color).toBe("string");
    });
  });

  it("cytoscape node base style uses data(color) for background-color", async () => {
    render(GraphPane);
    await waitFor(() => {
      const opts = cytoscapeOptions as {
        style: Array<{ selector: string; style: Record<string, unknown> }>;
      };
      const nodeStyle = opts.style.find((s) => s.selector === "node");
      expect(nodeStyle?.style["background-color"]).toBe("data(color)");
    });
  });
});

// ── Node sizing ────────────────────────────────────────────────────────────────

describe("GraphPane – backlink-proportional sizing", () => {
  it("node size is encoded in element data", async () => {
    render(GraphPane);
    await waitFor(() => {
      const opts = cytoscapeOptions as { elements: { nodes: Array<{ data: Record<string, unknown> }> } };
      const note1 = opts.elements.nodes.find((n) => n.data.id === "note-1");
      expect(typeof note1?.data.size).toBe("number");
    });
  });

  it("hub note (backlink_count=5) gets larger size than orphan (backlink_count=0)", async () => {
    render(GraphPane);
    await waitFor(() => {
      const opts = cytoscapeOptions as { elements: { nodes: Array<{ data: Record<string, unknown> }> } };
      const hub = opts.elements.nodes.find((n) => n.data.id === "note-1")!;
      const orphan = opts.elements.nodes.find((n) => n.data.id === "note-2")!;
      expect(hub.data.size as number).toBeGreaterThan(orphan.data.size as number);
    });
  });

  it("orphan note (backlink_count=0) uses minimum size (diameter 16px)", async () => {
    render(GraphPane);
    await waitFor(() => {
      const opts = cytoscapeOptions as { elements: { nodes: Array<{ data: Record<string, unknown> }> } };
      const orphan = opts.elements.nodes.find((n) => n.data.id === "note-2")!;
      // Min radius 8px → diameter 16px
      expect(orphan.data.size as number).toBe(16);
    });
  });

  it("maximum-backlink note does not exceed diameter 56px (radius 28)", async () => {
    render(GraphPane);
    await waitFor(() => {
      const opts = cytoscapeOptions as { elements: { nodes: Array<{ data: Record<string, unknown> }> } };
      opts.elements.nodes.forEach((n) => {
        expect(n.data.size as number).toBeLessThanOrEqual(56);
      });
    });
  });

  it("cytoscape node base style uses data(size) for width and height", async () => {
    render(GraphPane);
    await waitFor(() => {
      const opts = cytoscapeOptions as {
        style: Array<{ selector: string; style: Record<string, unknown> }>;
      };
      const nodeStyle = opts.style.find((s) => s.selector === "node");
      expect(nodeStyle?.style["width"]).toBe("data(size)");
      expect(nodeStyle?.style["height"]).toBe("data(size)");
    });
  });
});

// ── Stub node distinction ─────────────────────────────────────────────────────

describe("GraphPane – stub node distinction", () => {
  it("stub selector sets opacity to 0.6", async () => {
    render(GraphPane);
    await waitFor(() => {
      const opts = cytoscapeOptions as {
        style: Array<{ selector: string; style: Record<string, unknown> }>;
      };
      const stubStyle = opts.style.find((s) => s.selector === "node[kind='stub']");
      expect(stubStyle?.style["opacity"]).toBe(0.6);
    });
  });

  it("stub selector uses dashed border-style", async () => {
    render(GraphPane);
    await waitFor(() => {
      const opts = cytoscapeOptions as {
        style: Array<{ selector: string; style: Record<string, unknown> }>;
      };
      const stubStyle = opts.style.find((s) => s.selector === "node[kind='stub']");
      expect(stubStyle?.style["border-style"]).toBe("dashed");
    });
  });

  it("stub node always gets minimum size regardless of backlink count", async () => {
    render(GraphPane);
    await waitFor(() => {
      const opts = cytoscapeOptions as { elements: { nodes: Array<{ data: Record<string, unknown> }> } };
      const stub = opts.elements.nodes.find((n) => n.data.id === "stub-unknown.md")!;
      expect(stub.data.size as number).toBe(16); // min diameter
    });
  });

  it("stub node border-width is defined in stub selector", async () => {
    render(GraphPane);
    await waitFor(() => {
      const opts = cytoscapeOptions as {
        style: Array<{ selector: string; style: Record<string, unknown> }>;
      };
      const stubStyle = opts.style.find((s) => s.selector === "node[kind='stub']");
      expect(stubStyle?.style["border-width"]).toBeTruthy();
    });
  });
});

// ── Theme re-application ──────────────────────────────────────────────────────

describe("GraphPane – style re-apply on theme/accent change", () => {
  it("mutating documentElement class triggers cy.nodes().forEach data update", async () => {
    render(GraphPane);
    await waitFor(() => expect(cytoscapeOptions).toBeTruthy());

    // Simulate a theme class change (e.g. switching to light mode)
    document.documentElement.classList.add("light");
    // MutationObserver fires asynchronously
    await waitFor(() => {
      // After re-apply, style() should have been called at least once
      // OR nodes should have been iterated. Both work — we check via mockStyleFn
      // (since re-applying full style config is the documented approach).
      expect(mockStyleFn).toHaveBeenCalled();
    });
    // cleanup
    document.documentElement.classList.remove("light");
  });
});

// ── Node click navigation ──────────────────────────────────────────────────────

describe("GraphPane – node click navigation", () => {
  it("clicking a note node opens the note in the active pane", async () => {
    render(GraphPane);
    await waitFor(() => expect(tapHandlers.length).toBeGreaterThan(0));

    const noteNode: MockNode = {
      data: (key: string) => {
        const map: Record<string, unknown> = { id: "note-1", label: "My Note", kind: "note", entity_id: 1 };
        return map[key];
      },
    };
    tapHandlers[0]({ target: noteNode });

    expect(tabs.openTab).toHaveBeenCalledWith({
      type: "note",
      id: 1,
      title: "My Note",
    });
  });

  it("clicking a map node opens the map in the active pane", async () => {
    render(GraphPane);
    await waitFor(() => expect(tapHandlers.length).toBeGreaterThan(0));

    const mapNode: MockNode = {
      data: (key: string) => {
        const map: Record<string, unknown> = { id: "map-10", label: "World Map", kind: "map", entity_id: 10 };
        return map[key];
      },
    };
    tapHandlers[0]({ target: mapNode });

    expect(tabs.openTab).toHaveBeenCalledWith({
      type: "map",
      id: 10,
      title: "World Map",
    });
  });

  it("clicking a stub node does nothing (no openTab call)", async () => {
    render(GraphPane);
    await waitFor(() => expect(tapHandlers.length).toBeGreaterThan(0));

    const stubNode: MockNode = {
      data: (key: string) => {
        const map: Record<string, unknown> = { id: "stub-unknown.md", label: "unknown.md", kind: "stub" };
        return map[key];
      },
    };
    tapHandlers[0]({ target: stubNode });

    expect(tabs.openTab).not.toHaveBeenCalled();
  });
});

// ── Filter panel ──────────────────────────────────────────────────────────────

describe("GraphPane – filter panel", () => {
  it("renders a filter toggle button", () => {
    const { container } = render(GraphPane);
    expect(container.querySelector("[data-testid='filter-toggle']")).toBeTruthy();
  });

  it("filter panel is hidden initially", () => {
    const { container } = render(GraphPane);
    expect(container.querySelector("[data-testid='filter-panel']")).toBeFalsy();
  });

  it("clicking the filter toggle shows the filter panel", async () => {
    const { container } = render(GraphPane);
    const btn = container.querySelector("[data-testid='filter-toggle']") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => {
      expect(container.querySelector("[data-testid='filter-panel']")).toBeTruthy();
    });
  });

  it("clicking the filter toggle twice hides the panel again", async () => {
    const { container } = render(GraphPane);
    const btn = container.querySelector("[data-testid='filter-toggle']") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => expect(container.querySelector("[data-testid='filter-panel']")).toBeTruthy());
    await fireEvent.click(btn);
    await waitFor(() => {
      expect(container.querySelector("[data-testid='filter-panel']")).toBeFalsy();
    });
  });

  it("filter panel lists all vault tags from list_all_tags", async () => {
    const { container } = render(GraphPane);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("list_all_tags"));
    const btn = container.querySelector("[data-testid='filter-toggle']") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => {
      expect(container.querySelector("[data-testid='filter-tag-toggle-npc']")).toBeTruthy();
      expect(container.querySelector("[data-testid='filter-tag-toggle-quest']")).toBeTruthy();
    });
  });

  it("each tag row has a colored swatch element", async () => {
    const { container } = render(GraphPane);
    await waitFor(() => expect(cytoscapeOptions).toBeTruthy());
    const btn = container.querySelector("[data-testid='filter-toggle']") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => {
      expect(container.querySelector("[data-testid='filter-swatch-npc']")).toBeTruthy();
      expect(container.querySelector("[data-testid='filter-swatch-quest']")).toBeTruthy();
    });
  });

  it("npc swatch uses its explicit tag color from tag_graph_styles", async () => {
    const { container } = render(GraphPane);
    await waitFor(() => expect(cytoscapeOptions).toBeTruthy());
    const btn = container.querySelector("[data-testid='filter-toggle']") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => {
      const swatch = container.querySelector("[data-testid='filter-swatch-npc']") as HTMLElement;
      expect(swatch).toBeTruthy();
      expect(swatch.style.backgroundColor).toBeTruthy();
    });
  });

  it("filter panel shows an 'Untagged' row", async () => {
    const { container } = render(GraphPane);
    const btn = container.querySelector("[data-testid='filter-toggle']") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => {
      expect(container.querySelector("[data-testid='filter-untagged-toggle']")).toBeTruthy();
    });
  });

  it("tag toggle aria-checked is true when tag is visible (not hidden)", async () => {
    const { container } = render(GraphPane);
    await waitFor(() => expect(cytoscapeOptions).toBeTruthy());
    const btn = container.querySelector("[data-testid='filter-toggle']") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => {
      const toggle = container.querySelector("[data-testid='filter-tag-toggle-npc']") as HTMLElement;
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });
  });

  it("toggling a visible tag calls set_tag_graph_style with hidden: true", async () => {
    const { container } = render(GraphPane);
    await waitFor(() => expect(cytoscapeOptions).toBeTruthy());
    const btn = container.querySelector("[data-testid='filter-toggle']") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => expect(container.querySelector("[data-testid='filter-tag-toggle-npc']")).toBeTruthy());

    vi.mocked(invoke).mockClear();
    const toggle = container.querySelector("[data-testid='filter-tag-toggle-npc']") as HTMLElement;
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_tag_graph_style", {
        tag: "npc",
        color: "#ff0000",
        hidden: true,
      });
    });
  });

  it("toggling a tag from hidden=true calls set_tag_graph_style with hidden: false", async () => {
    // Override: npc starts hidden
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_graph_data") return Promise.resolve(mockGraphData);
      if (cmd === "get_tag_graph_styles") return Promise.resolve({ npc: { color: "#ff0000", hidden: true }, quest: { color: null, hidden: false } });
      if (cmd === "list_all_tags") return Promise.resolve(mockAllTags);
      if (cmd === "set_tag_graph_style") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    const { container } = render(GraphPane);
    await waitFor(() => expect(cytoscapeOptions).toBeTruthy());
    const btn = container.querySelector("[data-testid='filter-toggle']") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => expect(container.querySelector("[data-testid='filter-tag-toggle-npc']")).toBeTruthy());

    vi.mocked(invoke).mockClear();
    const toggle = container.querySelector("[data-testid='filter-tag-toggle-npc']") as HTMLElement;
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_tag_graph_style", {
        tag: "npc",
        color: "#ff0000",
        hidden: false,
      });
    });
  });

  it("toggling untagged row calls set_tag_graph_style with tag '' and hidden: true", async () => {
    const { container } = render(GraphPane);
    await waitFor(() => expect(cytoscapeOptions).toBeTruthy());
    const btn = container.querySelector("[data-testid='filter-toggle']") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => expect(container.querySelector("[data-testid='filter-untagged-toggle']")).toBeTruthy());

    vi.mocked(invoke).mockClear();
    const toggle = container.querySelector("[data-testid='filter-untagged-toggle']") as HTMLElement;
    await fireEvent.click(toggle);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("set_tag_graph_style", {
        tag: "",
        color: null,
        hidden: true,
      });
    });
  });

  it("each tag row has an 'Edit color' link", async () => {
    const { container } = render(GraphPane);
    await waitFor(() => expect(cytoscapeOptions).toBeTruthy());
    const btn = container.querySelector("[data-testid='filter-toggle']") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => {
      expect(container.querySelector("[data-testid='filter-edit-npc']")).toBeTruthy();
      expect(container.querySelector("[data-testid='filter-edit-quest']")).toBeTruthy();
    });
  });

  it("clicking 'Edit color' link sets searchPalette.settingsOpen to true", async () => {
    const { searchPalette } = await import("../lib/stores/search.svelte");
    searchPalette.settingsOpen = false;

    const { container } = render(GraphPane);
    await waitFor(() => expect(cytoscapeOptions).toBeTruthy());
    const btn = container.querySelector("[data-testid='filter-toggle']") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => expect(container.querySelector("[data-testid='filter-edit-npc']")).toBeTruthy());

    const editLink = container.querySelector("[data-testid='filter-edit-npc']") as HTMLElement;
    await fireEvent.click(editLink);

    expect(searchPalette.settingsOpen).toBe(true);
  });
});

// ── Node visibility (filter) ──────────────────────────────────────────────────

describe("GraphPane – node visibility filtering", () => {
  it("hiding 'npc' tag sets display:none on note-1 (which has primary_tag npc)", async () => {
    const { container } = render(GraphPane);
    await waitFor(() => expect(cytoscapeOptions).toBeTruthy());

    // Open filter panel and toggle npc off
    const btn = container.querySelector("[data-testid='filter-toggle']") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => expect(container.querySelector("[data-testid='filter-tag-toggle-npc']")).toBeTruthy());

    const toggle = container.querySelector("[data-testid='filter-tag-toggle-npc']") as HTMLElement;
    await fireEvent.click(toggle);

    await waitFor(() => {
      const npcStyles = nodeStyleStores.get("note-1");
      expect(npcStyles?.["display"]).toBe("none");
    });
  });

  it("hiding 'npc' does not set display:none on note-2 (which has primary_tag quest)", async () => {
    const { container } = render(GraphPane);
    await waitFor(() => expect(cytoscapeOptions).toBeTruthy());

    const btn = container.querySelector("[data-testid='filter-toggle']") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => expect(container.querySelector("[data-testid='filter-tag-toggle-npc']")).toBeTruthy());

    const toggle = container.querySelector("[data-testid='filter-tag-toggle-npc']") as HTMLElement;
    await fireEvent.click(toggle);

    await waitFor(() => {
      // note-1 should be hidden
      const npcStyles = nodeStyleStores.get("note-1");
      expect(npcStyles?.["display"]).toBe("none");
    });

    // note-2 (quest tag) should NOT be hidden
    const questStyles = nodeStyleStores.get("note-2");
    expect(questStyles?.["display"]).not.toBe("none");
  });

  it("edge e-0 (note-1 → note-2) gets display:none when note-1 is hidden", async () => {
    const { container } = render(GraphPane);
    await waitFor(() => expect(cytoscapeOptions).toBeTruthy());

    const btn = container.querySelector("[data-testid='filter-toggle']") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => expect(container.querySelector("[data-testid='filter-tag-toggle-npc']")).toBeTruthy());

    const toggle = container.querySelector("[data-testid='filter-tag-toggle-npc']") as HTMLElement;
    await fireEvent.click(toggle);

    await waitFor(() => {
      // note-1 (npc) hidden → edge e-0 (note-1→note-2) should also be hidden
      const edgeStyles = edgeStyleStores.get("e-0");
      expect(edgeStyles?.["display"]).toBe("none");
    });
  });

  it("hiding untagged sets display:none on note-3 (which has no primary tag)", async () => {
    const { container } = render(GraphPane);
    await waitFor(() => expect(cytoscapeOptions).toBeTruthy());

    const btn = container.querySelector("[data-testid='filter-toggle']") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => expect(container.querySelector("[data-testid='filter-untagged-toggle']")).toBeTruthy());

    const toggle = container.querySelector("[data-testid='filter-untagged-toggle']") as HTMLElement;
    await fireEvent.click(toggle);

    await waitFor(() => {
      const styles = nodeStyleStores.get("note-3");
      expect(styles?.["display"]).toBe("none");
    });
  });

  it("re-showing a hidden tag restores display:element on its nodes", async () => {
    // Start with npc hidden
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_graph_data") return Promise.resolve(mockGraphData);
      if (cmd === "get_tag_graph_styles") return Promise.resolve({ npc: { color: "#ff0000", hidden: true }, quest: { color: null, hidden: false } });
      if (cmd === "list_all_tags") return Promise.resolve(mockAllTags);
      if (cmd === "set_tag_graph_style") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    const { container } = render(GraphPane);
    await waitFor(() => expect(cytoscapeOptions).toBeTruthy());

    const btn = container.querySelector("[data-testid='filter-toggle']") as HTMLElement;
    await fireEvent.click(btn);
    await waitFor(() => expect(container.querySelector("[data-testid='filter-tag-toggle-npc']")).toBeTruthy());

    // Initially hidden → toggle to show
    const toggle = container.querySelector("[data-testid='filter-tag-toggle-npc']") as HTMLElement;
    await fireEvent.click(toggle);

    await waitFor(() => {
      const styles = nodeStyleStores.get("note-1");
      expect(styles?.["display"]).toBe("element");
    });
  });
});
