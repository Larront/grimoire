<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import cytoscape from "cytoscape";
  import type { Core } from "cytoscape";
  import { tabs } from "$lib/stores/tabs.svelte";

  // The five accent preset swatch hex values, in cycle order:
  // crimson → arcane → verdant → ice → amber
  const ACCENT_CYCLE = ["#c2483d", "#9b6bbf", "#5c9e6e", "#5b9ec9", "#c49a3c"];

  // Node sizing: radius in px (diameter = 2 × radius)
  const MIN_RADIUS = 8;
  const MAX_RADIUS = 28;

  // Map nodes use a fixed neutral teal (not tag-colored, not muted)
  const MAP_COLOR = "#6b9e8d";

  interface GraphNodeData {
    id: string;
    label: string;
    kind: "note" | "map" | "stub";
    entity_id?: number;
    primary_tag?: string | null;
    backlink_count?: number;
  }

  interface GraphEdgeData {
    id: string;
    source: string;
    target: string;
  }

  interface GraphData {
    nodes: GraphNodeData[];
    edges: GraphEdgeData[];
  }

  interface TagStyle {
    color: string | null;
    hidden: boolean;
  }

  let container: HTMLDivElement;
  let cy: Core | null = null;
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Stored in closure so reapplyStyles() can reference them
  let tagStylesMap = new Map<string, TagStyle>();
  let accentAssignments = new Map<string, string>();

  let observer: MutationObserver | null = null;

  /** Read --foreground-muted from computed CSS at call time (light/dark aware). */
  function getMutedColor(): string {
    return (
      getComputedStyle(document.documentElement)
        .getPropertyValue("--foreground-muted")
        .trim() || "#888"
    );
  }

  /**
   * Build the accent cycle assignments for tags with no explicit color.
   * Tags are visited in node encounter order; each unique null-color tag
   * gets the next slot in ACCENT_CYCLE (wrapping at 5).
   */
  function buildAccentAssignments(
    nodes: GraphNodeData[],
    styles: Map<string, TagStyle>,
  ): Map<string, string> {
    const assignments = new Map<string, string>();
    let cycleIdx = 0;
    for (const node of nodes) {
      if (node.primary_tag && !assignments.has(node.primary_tag)) {
        const style = styles.get(node.primary_tag);
        if (!style?.color) {
          assignments.set(node.primary_tag, ACCENT_CYCLE[cycleIdx % ACCENT_CYCLE.length]);
          cycleIdx++;
        }
      }
    }
    return assignments;
  }

  /** Compute the background color for a single node. */
  function computeNodeColor(
    kind: "note" | "map" | "stub",
    primaryTag: string | null | undefined,
  ): string {
    if (kind === "map") return MAP_COLOR;
    if (kind === "stub") return getMutedColor();
    // note node
    if (primaryTag) {
      const style = tagStylesMap.get(primaryTag);
      if (style?.color) return style.color;
      return accentAssignments.get(primaryTag) ?? getMutedColor();
    }
    return getMutedColor();
  }

  /**
   * Compute the diameter (px) for a node.
   * Stub and map nodes always get the minimum. Notes scale linearly with backlink count.
   */
  function computeNodeSize(node: GraphNodeData, maxBacklinks: number): number {
    if (node.kind === "stub" || node.kind === "map") return MIN_RADIUS * 2;
    const count = node.backlink_count ?? 0;
    if (maxBacklinks === 0 || count === 0) return MIN_RADIUS * 2;
    const radius =
      MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * (count / maxBacklinks);
    return Math.round(radius * 2);
  }

  /** The Cytoscape style array. Colors live in element data via data() mappers. */
  function buildStyleArray() {
    return [
      {
        selector: "node",
        style: {
          label: "data(label)",
          "background-color": "data(color)",
          width: "data(size)",
          height: "data(size)",
          "font-size": 10,
          color: "#333",
          "text-valign": "bottom",
          "text-halign": "center",
          "text-margin-y": 4,
        },
      },
      {
        selector: "node[kind='stub']",
        style: {
          opacity: 0.6,
          "border-style": "dashed",
          "border-width": 1.5,
          "border-color": "data(color)",
        },
      },
      {
        selector: "edge",
        style: {
          width: 1,
          "line-color": "#ccc",
          "target-arrow-color": "#ccc",
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
        },
      },
    ];
  }

  /**
   * Re-read muted color from CSS and update every node's stored color.
   * Called when the theme or accent class changes on <html>.
   */
  function reapplyStyles() {
    if (!cy) return;
    // Update only the color (muted color may have changed; accent cycle colors
    // are fixed hex values and don't change with theme)
    cy.nodes().forEach((n: unknown) => {
      const node = n as {
        data(key: string): unknown;
        data(key: string, val: unknown): void;
      };
      const kind = node.data("kind") as "note" | "map" | "stub";
      const primaryTag = node.data("primary_tag") as string | null | undefined;
      node.data("color", computeNodeColor(kind, primaryTag));
    });
    cy.style(buildStyleArray());
  }

  onMount(async () => {
    try {
      const [rawData, rawTagStyles] = await Promise.all([
        invoke<GraphData>("get_graph_data"),
        invoke<Record<string, TagStyle>>("get_tag_graph_styles"),
      ]);

      // Build tag styles map
      tagStylesMap = new Map(Object.entries(rawTagStyles ?? {}));

      // Build accent cycle assignments (encounter order across nodes)
      accentAssignments = buildAccentAssignments(rawData.nodes, tagStylesMap);

      // Compute max backlink count for proportional sizing
      const maxBacklinks = rawData.nodes.reduce(
        (max, n) => Math.max(max, n.backlink_count ?? 0),
        0,
      );

      cy = cytoscape({
        container,
        elements: {
          nodes: rawData.nodes.map((n) => ({
            data: {
              ...n,
              color: computeNodeColor(n.kind, n.primary_tag),
              size: computeNodeSize(n, maxBacklinks),
            },
          })),
          edges: rawData.edges.map((e) => ({ data: e })),
        },
        layout: { name: "cose" },
        style: buildStyleArray(),
        userZoomingEnabled: true,
        userPanningEnabled: true,
        minZoom: 0.1,
        maxZoom: 10,
      });

      cy.fit();

      cy.on("tap", "node", (e) => {
        const node = e.target;
        const kind = node.data("kind") as string;
        const entity_id = node.data("entity_id") as number | undefined;
        const label = node.data("label") as string;

        if (kind === "note" && entity_id != null) {
          tabs.openTab({ type: "note", id: entity_id, title: label });
        } else if (kind === "map" && entity_id != null) {
          tabs.openTab({ type: "map", id: entity_id, title: label });
        }
        // stub nodes: no navigation
      });

      // Re-apply styles when the user switches accent preset or theme (light/dark).
      // ThemeWatcher sets inline style properties in dark mode and class names in light
      // mode, so we observe both the style attribute and the class attribute.
      observer = new MutationObserver(reapplyStyles);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  onDestroy(() => {
    observer?.disconnect();
    cy?.destroy();
  });
</script>

<div class="relative flex flex-1 min-h-0 flex-col overflow-hidden bg-background">
  <!-- Container is always in DOM so cytoscape can bind to it -->
  <div
    bind:this={container}
    data-testid="graph-container"
    class="absolute inset-0"
  ></div>

  {#if loading}
    <div class="absolute inset-0 flex items-center justify-center bg-background/80 text-muted-foreground z-10">
      <span class="text-sm">Loading graph…</span>
    </div>
  {:else if error}
    <div class="absolute inset-0 flex items-center justify-center text-destructive z-10">
      <span class="text-sm">Failed to load graph: {error}</span>
    </div>
  {/if}
</div>
