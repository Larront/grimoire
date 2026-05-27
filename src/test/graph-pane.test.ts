import { render, waitFor, cleanup } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import GraphPane from "../lib/components/panes/GraphPane.svelte";
import { tabs } from "../lib/stores/tabs.svelte";

// ── Cytoscape mock ─────────────────────────────────────────────────────────────
// JSDOM has no canvas; mock cytoscape so the component mounts without errors.
// The mock records the options it was called with and provides a tap listener
// registry so tests can fire synthetic node-click events.
// mockStyleFn records cy.style([...]) calls so re-apply tests can verify.

type TapHandler = (e: { target: MockNode }) => void;
interface MockNode {
  data(key: string): unknown;
}

type CyNode = { data: (key?: string, val?: unknown) => unknown };

const tapHandlers: TapHandler[] = [];
let cytoscapeOptions: unknown = null;
let mockNodes: CyNode[] = [];
const mockFit = vi.fn();
const mockDestroy = vi.fn();
const mockStyleFn = vi.fn();

vi.mock("cytoscape", () => {
  return {
    default: vi.fn((opts: unknown) => {
      cytoscapeOptions = opts;
      // Build mock node objects from the options so data-update tests work
      const typedOpts = opts as { elements?: { nodes?: Array<{ data: Record<string, unknown> }> } };
      const nodeDataArr = typedOpts.elements?.nodes ?? [];
      const nodeStore = nodeDataArr.map((n) => {
        const store: Record<string, unknown> = { ...n.data };
        return {
          data: (key?: string, val?: unknown) => {
            if (val !== undefined && key !== undefined) { store[key] = val; return undefined; }
            if (key !== undefined) return store[key];
            return store;
          },
        } as CyNode;
      });
      mockNodes = nodeStore;
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
    return Promise.resolve(null);
  });
}

// ── Reset between tests ───────────────────────────────────────────────────────

beforeEach(() => {
  tapHandlers.length = 0;
  cytoscapeOptions = null;
  mockNodes = [];
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
