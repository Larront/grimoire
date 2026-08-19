<script lang="ts">
  /**
   * The chrome a pane's [[Details Pane]] is presented in — docked rail, floating
   * overlay, or mobile sheet — chosen by the pane's own `PaneDetailSurface`.
   *
   * ADR-0006 §2 and §4: one shell, rendered "docked or floating by its pane
   * host". The three variants used to be hand-written in each host, which is how
   * the map panels ended up at a different z-index, a different width, and a
   * hardcoded `fly` that ignored `prefers-reduced-motion`. Everything about the
   * box lives here; the body is the caller's snippet.
   */
  import type { Snippet } from "svelte";
  import { fly } from "svelte/transition";
  import * as Sheet from "$lib/components/ui/sheet/index.js";
  import type { PaneDetailSurface } from "$lib/details/pane-detail-surface.svelte";

  interface Props {
    surface: PaneDetailSurface;
    /** Whether the body should be showing. The caller's, because a note's surface
     *  is latched by its toggle while a map's follows the canvas selection. */
    open: boolean;
    /** Dismissal from the chrome itself (sheet escape/overlay press). */
    onclose: () => void;
    children: Snippet;
  }

  let { surface, open, onclose, children }: Props = $props();
</script>

{#if surface.mode === "sheet"}
  <!-- The sheet's latch is the overlay token, so its dismissal goes straight to
       `setOpenMobile` rather than through `onclose`: routing it through a toggle
       would turn a `false` arriving while the sheet is already closed into a
       press that opens it. -->
  <Sheet.Root bind:open={() => open, (v) => surface.setOpenMobile(v)}>
    <Sheet.Content
      side="right"
      data-slot="right-rail"
      data-mobile="true"
      class="w-[300px] p-0 [&>button]:hidden"
      showCloseButton={false}
    >
      <Sheet.Header class="sr-only">
        <Sheet.Title>Details panel</Sheet.Title>
        <Sheet.Description>Document metadata and details.</Sheet.Description>
      </Sheet.Header>
      {@render children()}
    </Sheet.Content>
  </Sheet.Root>
{:else if surface.mode === "docked"}
  <!-- Always in the DOM so opening and closing animates the pane's width rather
       than popping a 300px column in beside the editor. -->
  <aside
    data-slot="right-rail"
    data-mobile="false"
    data-state={open ? "open" : "closed"}
    class="flex w-0 shrink-0 flex-col overflow-hidden motion-reduce:transition-none
           transition-[width] duration-200 ease-linear data-[state=open]:w-[300px]"
  >
    <div class="flex h-full w-[300px] flex-col border-l border-background-border bg-background-subtle">
      {@render children()}
    </div>
  </aside>
{:else if open && surface.ready}
  <!-- Two layers, not one. Over a map, z-1000 is what clears Leaflet's own panes
       (400–700), and the map's container isolates, so that 1000 never leaves the
       pane. A note pane isolates nothing and its ancestors are all z-auto, so a
       float at 1000 there would paint over every dialog and sheet in the app
       (all `fixed z-50`, portalled to <body>) including their scrims.

       The two halves of the motion are declared separately, and the asymmetry is
       the point. `in:` is `|global` so it plays for a host that opens the panel
       from its own block one component up (the map panels, whose `{#if}` holds a
       selection the body needs while it is on screen). `out:` stays local so an
       ancestor block being destroyed removes this **immediately**: the map
       panel's body must unmount the moment its pane's tab changes, or the
       in-flight pin edit its teardown commits (#201) lands after the pane it
       belonged to is gone. A note pane's own toggle is this block's business, so
       its close does animate, with the note still under it. -->
  <div
    data-slot="right-rail"
    data-float="true"
    in:fly|global={surface.transition}
    out:fly={surface.transition}
    class={[
      "absolute top-4 right-4 flex max-h-[calc(100%-2rem)] w-80 flex-col overflow-hidden",
      "rounded-lg border border-background-border bg-background shadow-2xl",
      surface.overStackedHost ? "z-1000" : "z-50",
    ]}
  >
    {@render children()}
  </div>
{/if}
