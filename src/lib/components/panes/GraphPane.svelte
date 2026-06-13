<script module lang="ts">
  import cytoscape from "cytoscape";
  import d3Force from "cytoscape-d3-force";

  // Register the d3-force layout once for the whole module (idempotent).
  cytoscape.use(d3Force);
</script>

<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { api } from "$lib/api";
  import type { Core, LayoutOptions, StylesheetJson } from "cytoscape";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { notes } from "$lib/stores/notes.svelte";
  import { searchPalette } from "$lib/stores/search.svelte";
  import Filter from "@lucide/svelte/icons/filter";
  import Search from "@lucide/svelte/icons/search";

  // The five accent preset swatch hex values, in cycle order:
  // crimson → arcane → verdant → ice → amber
  const ACCENT_CYCLE = ["#c2483d", "#9b6bbf", "#5c9e6e", "#5b9ec9", "#c49a3c"];

  // Node sizing: radius in px (diameter = 2 × radius)
  const MIN_RADIUS = 8;
  const MAX_RADIUS = 28;

  // Map nodes use a fixed neutral teal (not tag-colored, not muted)
  const MAP_COLOR = "#6b9e8d";

  // Fade duration (ms) for the hover neighbor-dimming transition.
  const DIM_FADE_MS = 150;

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

  // Filter panel state
  let filterOpen = $state(false);
  let allTags = $state<string[]>([]);

  // Search state
  let searchQuery = $state("");
  /** ID of the first node matching the current search query; null when none. */
  let firstMatchId: string | null = null;

  // Stored in closure so reapplyStyles() can reference them
  // tagStylesMap is $state so the filter panel template reacts to changes
  let tagStylesMap = $state(new Map<string, TagStyle>());
  let accentAssignments = new Map<string, string>();

  let observer: MutationObserver | null = null;

  // Undirected adjacency built from edges, used for neighbor-dimming on hover.
  let adjacency = new Map<string, Set<string>>();

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
          assignments.set(
            node.primary_tag,
            ACCENT_CYCLE[cycleIdx % ACCENT_CYCLE.length],
          );
          cycleIdx++;
        }
      }
    }
    return assignments;
  }

  /** Resolve the display color for a tag: explicit color → accent cycle → muted foreground. */
  function tagColor(tag: string): string {
    const style = tagStylesMap.get(tag);
    return style?.color ?? accentAssignments.get(tag) ?? getMutedColor();
  }

  /** Compute the background color for a single node. */
  function computeNodeColor(
    kind: "note" | "map" | "stub",
    primaryTag: string | null | undefined,
  ): string {
    if (kind === "map") return MAP_COLOR;
    if (kind === "stub") return getMutedColor();
    return primaryTag ? tagColor(primaryTag) : getMutedColor();
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

  /**
   * The Cytoscape style array. Colors live in element data via data() mappers.
   * Nodes render as translucent orbs (soft fill + colored stroke), edges are thin
   * and undirected — an Obsidian-like aesthetic. Label/edge colors are read from
   * CSS at build time so reapplyStyles() picks up theme changes.
   */
  function buildStyleArray(): StylesheetJson {
    const muted = getMutedColor();
    return [
      {
        selector: "node",
        style: {
          label: "data(label)",
          "background-color": "data(color)",
          "background-opacity": 0.25,
          "border-color": "data(color)",
          "border-width": 2,
          "border-opacity": 0.9,
          width: "data(size)",
          height: "data(size)",
          "font-size": 10,
          color: muted,
          "text-valign": "bottom",
          "text-halign": "center",
          "text-margin-y": 4,
          "min-zoomed-font-size": 7,
        },
      },
      {
        selector: "node[kind='stub']",
        style: {
          opacity: 0.6,
          "background-opacity": 0.12,
          "border-style": "dashed",
          "border-width": 1.5,
          "border-color": "data(color)",
        },
      },
      {
        selector: "edge",
        style: {
          width: 1,
          "line-color": muted,
          "line-opacity": 0.25,
          "curve-style": "straight",
        },
      },
      // Hover focus (applyNeighborDim) toggles .dimmed instead of animating
      // per-element opacity — one stylesheet transition scales to large graphs.
      // These rules come last so they win over the stub kind selector above.
      {
        selector: "node, edge",
        style: {
          "transition-property": "opacity",
          // Bare numbers are milliseconds (cytoscape's implicit time unit).
          "transition-duration": DIM_FADE_MS,
        },
      },
      {
        selector: "node.dimmed",
        style: { opacity: 0.12 },
      },
      {
        selector: "edge.dimmed",
        style: { opacity: 0.05 },
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

  /** Whether a tag is currently hidden in the filter. Uses "" for untagged. */
  function isFilterTagHidden(tag: string): boolean {
    return tagStylesMap.get(tag)?.hidden ?? false;
  }

  /**
   * Toggle a tag's visibility in the filter panel.
   * Writes to set_tag_graph_style (same as Settings) so they stay in sync.
   * Uses "" (empty string) as the sentinel key for untagged notes.
   */
  async function toggleFilterTag(tag: string) {
    const current = tagStylesMap.get(tag) ?? { color: null, hidden: false };
    const hidden = !current.hidden;
    tagStylesMap = new Map(tagStylesMap).set(tag, {
      color: current.color,
      hidden,
    });
    await api.setTagGraphStyle(tag, current.color, hidden);
    updateCyVisibility();
  }

  /**
   * Update cytoscape node and edge display based on the current tagStylesMap.
   * Nodes whose primary_tag is hidden (or untagged with "" hidden) get display:none.
   * Edges involving a hidden node are also set to display:none.
   * Cytoscape treats display:none as full removal from the layout.
   */
  function updateCyVisibility() {
    if (!cy) return;

    type CyElem = {
      data(k: string): unknown;
      style(k: string, v?: unknown): unknown;
      source(): { style(k: string): unknown };
      target(): { style(k: string): unknown };
    };

    cy.nodes().forEach((n: unknown) => {
      const node = n as CyElem;
      const kind = node.data("kind") as string;
      const primaryTag = node.data("primary_tag") as string | null | undefined;

      // Stub nodes are not tag-filtered; always keep them visible
      if (kind === "stub") return;

      // Use "" as the untagged sentinel
      const lookupTag = primaryTag ?? "";
      const hidden = tagStylesMap.get(lookupTag)?.hidden ?? false;
      node.style("display", hidden ? "none" : "element");
    });

    cy.edges().forEach((e: unknown) => {
      const edge = e as CyElem;
      const srcHidden = edge.source().style("display") === "none";
      const tgtHidden = edge.target().style("display") === "none";
      edge.style("display", srcHidden || tgtHidden ? "none" : "element");
    });
  }

  /** Open the Settings dialog scrolled to the Graph section. */
  function openGraphSettings() {
    searchPalette.settingsOpen = true;
  }

  /**
   * Highlight nodes whose label contains `query` (case-insensitive).
   * Non-matching nodes are dimmed to 20% opacity; matching nodes stay at 1.
   * An empty query removes the opacity bypass entirely — a lingering bypass
   * would override the hover `.dimmed` class for good — and clears any dim
   * classes left behind by a mouseout that the active-search guard swallowed.
   * Also updates `firstMatchId` for Enter-key camera focus.
   */
  function applySearchHighlight(query: string) {
    if (!cy) return;
    const q = query.trim().toLowerCase();
    firstMatchId = null;

    cy.nodes().forEach((n: unknown) => {
      const node = n as {
        data(key: string): unknown;
        style(key: string, val: unknown): void;
        removeStyle(key: string): void;
      };
      if (!q) {
        node.removeStyle("opacity");
        return;
      }
      const label = ((node.data("label") as string) ?? "").toLowerCase();
      const matches = label.includes(q);
      node.style("opacity", matches ? 1 : 0.2);
      if (matches && firstMatchId === null) {
        firstMatchId = node.data("id") as string;
      }
    });

    if (!q) applyNeighborDim(null);
  }

  /**
   * Animate the Cytoscape viewport to center and zoom to the first matching
   * node. No-op when there is no current match.
   */
  function focusFirstMatch() {
    if (!cy || !firstMatchId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cyAny = cy as any;
    const matched = cyAny.getElementById(firstMatchId);
    if (matched && matched.length > 0) {
      cyAny.animate({ fit: { eles: matched, padding: 80 }, duration: 400 });
    }
  }

  /**
   * Dim everything except the hovered node and its direct neighbors (Obsidian-style
   * focus) by toggling the `dimmed` class — the stylesheet's opacity transition does
   * the fade, so this stays one style pass instead of N animations on large graphs.
   * Passing null restores full opacity. No-op while a search is active so the two
   * highlight mechanisms don't fight over opacity.
   */
  function applyNeighborDim(focusId: string | null) {
    if (!cy || searchQuery.trim()) return;
    const connected = focusId
      ? new Set<string>([focusId, ...(adjacency.get(focusId) ?? [])])
      : null;

    type Classable = {
      data(k: string): unknown;
      toggleClass(name: string, toggle: boolean): void;
    };

    cy.batch(() => {
      cy!.nodes().forEach((n: unknown) => {
        const node = n as Classable;
        const id = node.data("id") as string;
        node.toggleClass("dimmed", connected != null && !connected.has(id));
      });

      cy!.edges().forEach((e: unknown) => {
        const edge = e as Classable;
        const touches =
          focusId != null &&
          (edge.data("source") === focusId || edge.data("target") === focusId);
        edge.toggleClass("dimmed", focusId != null && !touches);
      });
    });
  }

  async function createNoteFromStub(label: string) {
    try {
      const newNote = await api.createNote(label, label, null);
      await notes.load();
      // navigateOpen so the Graph view is on the back stack after creating the note.
      tabs.navigateOpen({
        type: "note",
        id: newNote.id,
        title: newNote.title,
        rename: true,
      });
    } catch (e) {
      console.error("create_note from stub failed:", e);
    }
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      focusFirstMatch();
    } else if (e.key === "Escape") {
      searchQuery = "";
      (e.target as HTMLInputElement).value = "";
    }
  }

  // Re-apply search highlight whenever searchQuery changes (including clear).
  $effect(() => {
    applySearchHighlight(searchQuery);
  });

  onMount(async () => {
    try {
      const [rawData, rawTagStyles, tags] = await Promise.all([
        api.getGraphData(),
        api.getTagGraphStyles(),
        api.listAllTags(),
      ]);

      // Build tag styles map
      tagStylesMap = new Map(Object.entries(rawTagStyles ?? {}));

      // Store ledger tags for the filter panel
      allTags = tags ?? [];

      // Build accent cycle assignments (encounter order across nodes)
      // Generated node `kind` is `string`; the local GraphNodeData refines it to
      // a "map"|"note"|"stub" union. The backend only ever emits those values.
      const graphNodes = rawData.nodes as GraphNodeData[];
      accentAssignments = buildAccentAssignments(graphNodes, tagStylesMap);

      // Compute max backlink count for proportional sizing
      const maxBacklinks = rawData.nodes.reduce(
        (max, n) => Math.max(max, n.backlink_count ?? 0),
        0,
      );

      // Build undirected adjacency for neighbor-dimming on hover
      adjacency = new Map<string, Set<string>>();
      for (const e of rawData.edges) {
        if (!adjacency.has(e.source)) adjacency.set(e.source, new Set());
        if (!adjacency.has(e.target)) adjacency.set(e.target, new Set());
        adjacency.get(e.source)!.add(e.target);
        adjacency.get(e.target)!.add(e.source);
      }

      // Seed nodes on a circle so the initial camera frame is sensible, then let a
      // continuously-running ("warm") d3-force simulation relax them. Keeping the sim
      // alive is what makes dragging feel springy: the extension pins the grabbed node
      // and re-heats the simulation on grab/free, so neighbors react live.
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 600;
      const ringX = w / 2;
      const ringY = h / 2;
      const ringRadius = Math.min(w, h) * 0.4 || 240;
      const nodeCount = rawData.nodes.length;

      // ── Physics knobs (d3-force) ──────────────────────────────────────────────
      // linkDistance        spring rest length — how far apart linked nodes settle
      // manyBodyStrength    node repulsion — more negative pushes everything apart
      // manyBodyDistanceMax caps repulsion range so distant nodes stop perturbing
      //                     one another — lets the layout settle instead of drifting
      // velocityDecay       damping — 0 = bouncy/floaty, 1 = stiff/dead-stop
      // alphaDecay          cooling rate — higher reaches a dead stop sooner
      // collideRadius       hard minimum spacing so node circles don't overlap
      //
      // Obsidian feel: firm, well-damped forces that snap into place, then cool to
      // a FULL stop in ~2.5s. We keep `infinite: true` only so the plugin leaves
      // its grab/free handlers wired for reheat-on-drag; the alphaTarget(0) reset
      // on `free` (below) undoes the plugin's habit of pinning alphaTarget at ~0.33
      // forever after the first drag — that pin is what made the graph jiggle
      // endlessly and never resolve. linkStrength is left unset so d3 uses its
      // degree-based default (links to hubs are softer, so hubs don't get yanked).
      const layout = {
        name: "d3-force",
        animate: true,
        infinite: true,
        // Resolve edge source/target by the node's `id` field, not d3's default
        // array index — our edges reference nodes by string id.
        linkId: (d: { id: string }) => d.id,
        alphaDecay: 0.04,
        velocityDecay: 0.5,
        linkDistance: 160,
        manyBodyStrength: -500,
        manyBodyDistanceMax: 800,
        // Size-aware so big (high-backlink) nodes get more breathing room than the
        // flat radius did — `size` is the node diameter, +12px of padding/gap.
        collideRadius: (d: { size: number }) => d.size / 2 + 12,
      } as unknown as LayoutOptions;

      cy = cytoscape({
        container,
        elements: {
          nodes: graphNodes.map((n, i) => ({
            data: {
              ...n,
              color: computeNodeColor(n.kind, n.primary_tag),
              size: computeNodeSize(n, maxBacklinks),
            },
            position: {
              x: ringX + ringRadius * Math.cos((2 * Math.PI * i) / nodeCount),
              y: ringY + ringRadius * Math.sin((2 * Math.PI * i) / nodeCount),
            },
          })),
          edges: rawData.edges.map((e) => ({ data: e })),
        },
        layout: { name: "preset" },
        style: buildStyleArray(),
        userZoomingEnabled: true,
        userPanningEnabled: true,
        minZoom: 0.1,
        maxZoom: 10,
      });

      // Run the force sim explicitly (rather than via the constructor's `layout`
      // option) so we keep a handle on it. The preset layout above just seeds the
      // ring positions; d3-force relaxes them from there.
      const sim = cy.layout(layout);
      sim.run();

      // The plugin pins the sim's alphaTarget at ~0.33 on every grab AND free and
      // never lowers it, so once you drag a node the graph reheats and then never
      // cools back down. Resetting alphaTarget to 0 on release lets the drag reheat
      // the layout (neighbors follow live) and then settle to a dead stop.
      cy.on("free", "node", () => {
        // Defer past the plugin's own `free` handler (which sets alphaTarget to
        // ~0.33), then lower the target so the sim cools to rest.
        requestAnimationFrame(() => {
          const d3sim = (
            sim as unknown as { simulation?: { alphaTarget(v: number): void } }
          ).simulation;
          d3sim?.alphaTarget(0);
        });
      });

      cy.fit(undefined, 60);

      // Apply initial visibility from tag_graph_styles (hidden tags are hidden at load)
      updateCyVisibility();

      cy.on("tap", "node", (e) => {
        const node = e.target;
        const kind = node.data("kind") as string;
        const entity_id = node.data("entity_id") as number | undefined;
        const label = node.data("label") as string;

        // navigateOpen (not openTab) so the Graph tab is pushed onto the pane's
        // back stack — the toolbar Back button then returns here from the note/map.
        if (kind === "note" && entity_id != null) {
          tabs.navigateOpen({ type: "note", id: entity_id, title: label });
        } else if (kind === "map" && entity_id != null) {
          tabs.navigateOpen({ type: "map", id: entity_id, title: label });
        } else if (kind === "stub") {
          createNoteFromStub(label);
        }
      });

      // On node hover: dim everything except the node and its neighbors, and show a
      // "create" cursor over stub nodes to signal the click-to-create affordance.
      cy.on("mouseover", "node", (e) => {
        const node = e.target;
        if (node.data("kind") === "stub") container.style.cursor = "cell";
        applyNeighborDim(node.data("id") as string);
      });
      cy.on("mouseout", "node", () => {
        container.style.cursor = "";
        applyNeighborDim(null);
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

<div
  class="relative flex flex-1 min-h-0 flex-col overflow-hidden bg-background"
>
  <!-- Toolbar overlay — search input + filter toggle, anchored top-right -->
  <div class="absolute top-2 right-2 z-20 flex items-center gap-1">
    <!-- Search input -->
    <div class="relative flex items-center">
      <Search
        class="pointer-events-none absolute left-2 size-3 text-foreground-muted"
      />
      <input
        data-testid="graph-search"
        type="text"
        placeholder="Search nodes…"
        bind:value={searchQuery}
        onkeydown={handleSearchKeydown}
        class="h-7 w-36 rounded border border-border bg-background/80 pl-6 pr-2 text-xs text-foreground placeholder:text-foreground-muted shadow focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>

    <!-- Filter toggle button -->
    <button
      data-testid="filter-toggle"
      aria-label="Toggle filter panel"
      aria-pressed={filterOpen}
      type="button"
      onclick={() => (filterOpen = !filterOpen)}
      class="flex size-7 items-center justify-center rounded bg-background/80 text-foreground-muted hover:text-foreground shadow border border-border transition-colors {filterOpen
        ? 'bg-primary/10 text-primary'
        : ''}"
    >
      <Filter class="size-4" />
    </button>
  </div>

  <!-- Filter panel overlay — anchored to top-right -->
  {#if filterOpen}
    <div
      data-testid="filter-panel"
      class="absolute top-10 right-2 z-20 w-64 rounded-lg bg-background/95 border border-border shadow-lg p-3 flex flex-col gap-2 max-h-[80%] overflow-y-auto backdrop-blur-sm"
    >
      <p
        class="text-xs font-semibold text-foreground-muted uppercase tracking-wider"
      >
        Filter by tag
      </p>

      {#each allTags as tag (tag)}
        <div class="flex items-center gap-2 min-w-0">
          <!-- Color swatch -->
          <span
            data-testid="filter-swatch-{tag}"
            class="size-3 rounded-full shrink-0 border border-border/40"
            style="background-color: {tagColor(tag)}"
          ></span>

          <!-- Tag label -->
          <span class="flex-1 text-sm text-foreground truncate">{tag}</span>

          <!-- Edit color link -->
          <a
            data-testid="filter-edit-{tag}"
            href="#settings-graph"
            onclick={(e) => {
              e.preventDefault();
              openGraphSettings();
            }}
            class="text-xs text-foreground-muted hover:text-foreground shrink-0 transition-colors"
            >Edit →</a
          >

          <!-- Show/hide toggle -->
          <button
            type="button"
            role="switch"
            data-testid="filter-tag-toggle-{tag}"
            aria-checked={!isFilterTagHidden(tag)}
            aria-label="Show {tag} in graph"
            onclick={() => toggleFilterTag(tag)}
            class="relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background {!isFilterTagHidden(
              tag,
            )
              ? 'bg-primary'
              : 'bg-input'}"
          >
            <span
              class="pointer-events-none inline-block h-3 w-3 rounded-full bg-background shadow ring-0 transition-transform {!isFilterTagHidden(
                tag,
              )
                ? 'translate-x-3'
                : 'translate-x-0'}"
            ></span>
          </button>
        </div>
      {/each}

      <!-- Untagged row (separator) -->
      <div
        class="flex items-center gap-2 min-w-0 border-t border-border pt-2 mt-1"
      >
        <!-- Swatch uses muted color -->
        <span
          data-testid="filter-swatch-__untagged__"
          class="size-3 rounded-full shrink-0 border border-border/40"
          style="background-color: {getMutedColor()}"
        ></span>

        <span class="flex-1 text-sm text-foreground-muted truncate"
          >Untagged</span
        >

        <!-- Show/hide toggle for untagged notes -->
        <button
          type="button"
          role="switch"
          data-testid="filter-untagged-toggle"
          aria-checked={!isFilterTagHidden("")}
          aria-label="Show untagged notes in graph"
          onclick={() => toggleFilterTag("")}
          class="relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background {!isFilterTagHidden(
            '',
          )
            ? 'bg-primary'
            : 'bg-input'}"
        >
          <span
            class="pointer-events-none inline-block h-3 w-3 rounded-full bg-background shadow ring-0 transition-transform {!isFilterTagHidden(
              '',
            )
              ? 'translate-x-3'
              : 'translate-x-0'}"
          ></span>
        </button>
      </div>
    </div>
  {/if}

  <!-- Container is always in DOM so cytoscape can bind to it -->
  <div
    bind:this={container}
    data-testid="graph-container"
    class="flex-1 min-h-0 w-full"
  ></div>

  {#if loading}
    <div
      class="absolute inset-0 flex items-center justify-center bg-background/80 text-muted-foreground z-10"
    >
      <span class="text-sm">Loading graph…</span>
    </div>
  {:else if error}
    <div
      class="absolute inset-0 flex items-center justify-center text-destructive z-10"
    >
      <span class="text-sm">Failed to load graph: {error}</span>
    </div>
  {/if}
</div>
