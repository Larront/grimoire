<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import cytoscape from "cytoscape";
  import type { Core } from "cytoscape";
  import { tabs } from "$lib/stores/tabs.svelte";

  interface GraphNodeData {
    id: string;
    label: string;
    kind: "note" | "map" | "stub";
    entity_id?: number;
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

  let container: HTMLDivElement;
  let cy: Core | null = null;
  let loading = $state(true);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      const data = await invoke<GraphData>("get_graph_data");

      cy = cytoscape({
        container,
        elements: {
          nodes: data.nodes.map((n) => ({ data: n })),
          edges: data.edges.map((e) => ({ data: e })),
        },
        layout: { name: "cose" },
        style: [
          {
            selector: "node",
            style: {
              label: "data(label)",
              "background-color": "#888",
              "font-size": 10,
              color: "#333",
              "text-valign": "bottom",
              "text-halign": "center",
              "text-margin-y": 4,
              width: 20,
              height: 20,
            },
          },
          {
            selector: "node[kind='stub']",
            style: {
              "background-color": "#bbb",
              opacity: 0.5,
            },
          },
          {
            selector: "node[kind='map']",
            style: {
              "background-color": "#6b9",
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
        ],
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
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  });

  onDestroy(() => {
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
