import { render, waitFor, cleanup } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import GraphPane from "../lib/components/panes/GraphPane.svelte";
import { tabs } from "../lib/stores/tabs.svelte";

// ── Cytoscape mock ─────────────────────────────────────────────────────────────
// JSDOM has no canvas; mock cytoscape so the component mounts without errors.
// The mock records the options it was called with and provides a tap listener
// registry so tests can fire synthetic node-click events.

type TapHandler = (e: { target: MockNode }) => void;
interface MockNode {
  data(key: string): unknown;
}

const tapHandlers: TapHandler[] = [];
let cytoscapeOptions: unknown = null;
const mockFit = vi.fn();
const mockDestroy = vi.fn();

vi.mock("cytoscape", () => {
  return {
    default: vi.fn((opts: unknown) => {
      cytoscapeOptions = opts;
      return {
        on: vi.fn((event: string, selector: string, handler: TapHandler) => {
          if (event === "tap") tapHandlers.push(handler);
        }),
        fit: mockFit,
        destroy: mockDestroy,
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

const mockGraphData = {
  nodes: [
    { id: "note-1", label: "My Note", kind: "note", entity_id: 1 },
    { id: "note-2", label: "Other Note", kind: "note", entity_id: 2 },
    { id: "map-10", label: "World Map", kind: "map", entity_id: 10 },
    { id: "stub-unknown.md", label: "unknown.md", kind: "stub" },
  ],
  edges: [
    { id: "e-0", source: "note-1", target: "note-2" },
    { id: "e-1", source: "note-1", target: "stub-unknown.md" },
    { id: "e-2", source: "map-10", target: "note-1" },
  ],
};

beforeEach(() => {
  tapHandlers.length = 0;
  cytoscapeOptions = null;
  mockFit.mockClear();
  mockDestroy.mockClear();
  vi.mocked(invoke).mockResolvedValue(null);
  vi.mocked(tabs.openTab).mockClear();
});

afterEach(() => {
  cleanup();
});

// ── Shell rendering ────────────────────────────────────────────────────────────

describe("GraphPane – shell", () => {
  it("renders the graph container element", () => {
    vi.mocked(invoke).mockResolvedValue(mockGraphData);
    const { container } = render(GraphPane);
    expect(container.querySelector("[data-testid='graph-container']")).toBeTruthy();
  });

  it("calls get_graph_data on mount", async () => {
    vi.mocked(invoke).mockResolvedValue(mockGraphData);
    render(GraphPane);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_graph_data");
    });
  });

  it("initialises cytoscape with cose layout after data loads", async () => {
    vi.mocked(invoke).mockResolvedValue(mockGraphData);
    render(GraphPane);
    await waitFor(() => {
      expect(cytoscapeOptions).toBeTruthy();
      const opts = cytoscapeOptions as { layout: { name: string } };
      expect(opts.layout.name).toBe("cose");
    });
  });

  it("passes nodes and edges from get_graph_data to cytoscape", async () => {
    vi.mocked(invoke).mockResolvedValue(mockGraphData);
    render(GraphPane);
    await waitFor(() => {
      const opts = cytoscapeOptions as {
        elements: {
          nodes: Array<{ data: unknown }>;
          edges: Array<{ data: unknown }>;
        };
      };
      expect(opts.elements.nodes).toHaveLength(4);
      expect(opts.elements.edges).toHaveLength(3);
    });
  });

  it("calls cy.fit() after layout completes", async () => {
    vi.mocked(invoke).mockResolvedValue(mockGraphData);
    render(GraphPane);
    await waitFor(() => {
      expect(mockFit).toHaveBeenCalled();
    });
  });
});

// ── Node click navigation ──────────────────────────────────────────────────────

describe("GraphPane – node click navigation", () => {
  it("clicking a note node opens the note in the active pane", async () => {
    vi.mocked(invoke).mockResolvedValue(mockGraphData);
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
    vi.mocked(invoke).mockResolvedValue(mockGraphData);
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
    vi.mocked(invoke).mockResolvedValue(mockGraphData);
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
