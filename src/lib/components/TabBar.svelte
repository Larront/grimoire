<script lang="ts">
  import MiddleTruncate from "$lib/components/MiddleTruncate.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import {
    FileText,
    Map as MapIcon,
    Music2,
    Clapperboard,
    ChevronRight,
    X,
    Plus,
    File,
    Network,
    NotebookPen,
    LayoutTemplate,
    BookOpen,
    CopyX,
    ListX,
    PanelLeftOpen,
    PanelRightOpen,
  } from "@lucide/svelte";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { tabKey, type TabType } from "$lib/stores/tabs.svelte";
  import { shortcut } from "$lib/utils/keyboard";
  import { tick } from "svelte";

  interface Props {
    pane: "left" | "right";
  }

  let { pane }: Props = $props();

  const tabPane = $derived(pane === "left" ? tabs.left : tabs.right);
  const tabList = $derived(tabPane?.tabs ?? []);
  const activeIndex = $derived(tabPane?.activeIndex ?? 0);

  let hasOverflow = $state(false);
  let stripEl = $state<HTMLElement | null>(null);

  // ── Pointer-based drag ────────────────────────────────────────────────────
  // Using pointer events + setPointerCapture instead of HTML5 DnD, which does
  // not work reliably in Tauri's WebView2 (OS-level drag intercepts dragover).

  let isDragging = $state(false);
  let dragSrcIdx = $state(-1);
  let ghostX = $state(0);
  let ghostY = $state(0);
  let dropIdx = $state<number | null>(null); // same-pane reorder target
  let crossPaneDrop = $state(false); // cursor is over the other pane

  // Non-reactive: start position for dead-zone check
  let _startX = 0;
  let _startY = 0;

  function onChipPointerDown(e: PointerEvent, i: number) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragSrcIdx = i;
    _startX = e.clientX;
    _startY = e.clientY;
  }

  function onChipPointerMove(e: PointerEvent, i: number) {
    if (dragSrcIdx !== i) return;

    const dx = e.clientX - _startX;
    const dy = e.clientY - _startY;
    if (!isDragging && dx * dx + dy * dy < 25) return; // 5 px dead zone

    isDragging = true;
    ghostX = e.clientX;
    ghostY = e.clientY;
    tabs.setDragging({ pane, index: i });

    const otherPane = pane === "left" ? "right" : "left";

    // Use getBoundingClientRect instead of elementsFromPoint for cross-pane
    // detection — absolutely-positioned pointer-events:none elements are
    // skipped by elementsFromPoint in Chromium/WebView2.
    const otherPaneEl = document.querySelector(
      `[data-pane-content="${otherPane}"]`,
    ) as HTMLElement | null;
    if (otherPaneEl) {
      const r = otherPaneEl.getBoundingClientRect();
      if (
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom
      ) {
        crossPaneDrop = true;
        dropIdx = null;
        return;
      }
    }

    crossPaneDrop = false;

    const els = document.elementsFromPoint(e.clientX, e.clientY);
    const sameChip = els.find(
      (el) => el.hasAttribute("data-tab-chip") && el.getAttribute("data-tab-pane") === pane,
    ) as HTMLElement | undefined;

    if (sameChip) {
      const idx = parseInt(sameChip.dataset.tabIndex ?? "-1", 10);
      dropIdx = !isNaN(idx) && idx !== i ? idx : null;
    } else {
      dropIdx = null;
    }
  }

  function onChipPointerUp(e: PointerEvent, i: number) {
    if (dragSrcIdx !== i) return;
    if (isDragging) {
      if (dropIdx !== null) {
        tabs.reorderTab(pane, i, dropIdx);
      } else if (crossPaneDrop) {
        tabs.moveToOtherPane(pane, i);
      }
    }
    clearDrag();
  }

  function clearDrag() {
    isDragging = false;
    dragSrcIdx = -1;
    dropIdx = null;
    crossPaneDrop = false;
    tabs.setDragging(null);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function getIcon(type: TabType) {
    switch (type) {
      case "note":
        return FileText;
      case "map":
        return MapIcon;
      case "scenes":
        return Clapperboard;
      case "scene":
        return Music2;
      case "graph":
        return Network;
      case "quickNotes":
        return NotebookPen;
      case "template":
        return LayoutTemplate;
      case "pdf":
        return BookOpen;
      case "empty":
        return File;
    }
  }

  // ── More tabs than fit ──────────────────────────────────────────────────
  // Tabs narrow to a minimum, then the strip scrolls, with the open tab kept in view;
  // the + and the list of every tab stay at the end. The bar used to grow past its pane
  // instead, and with a dozen tabs the open one, the + and the Details toggle were all
  // off screen with no way to reach them (2026-10 design review).
  function measureOverflow() {
    if (stripEl) hasOverflow = stripEl.scrollWidth > stripEl.clientWidth + 1;
  }

  function observeOverflow(node: HTMLElement) {
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(node);
    // A vertical wheel scrolls the strip sideways: a mouse has no other way along it.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || node.scrollWidth <= node.clientWidth) return;
      e.preventDefault();
      node.scrollLeft += e.deltaY;
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return {
      destroy() {
        observer.disconnect();
        node.removeEventListener("wheel", onWheel);
      },
    };
  }

  // Opening, closing or switching tabs changes what fits and which one must be seen.
  $effect(() => {
    const at = activeIndex;
    void tabList.length;
    tick().then(() => {
      measureOverflow();
      stripEl
        ?.querySelector<HTMLElement>(`[data-tab-index="${at}"]`)
        ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    });
  });

  // ← and → move along the tabs, as a tab strip's arrows do, taking focus with them.
  async function onTabKeydown(e: KeyboardEvent, i: number) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      tabs.activateTab(pane, i);
      return;
    }
    const to = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : null;
    if (to === null || to < 0 || to >= tabList.length) return;
    e.preventDefault();
    tabs.activateTab(pane, to);
    await tick();
    stripEl?.querySelector<HTMLElement>(`[data-tab-index="${to}"] [role="tab"]`)?.focus();
  }
</script>

<div
  class="flex h-(--tab-bar-h) min-w-0 flex-1 items-center border-b border-sidebar-border bg-background overflow-hidden"
>
  <div
    bind:this={stripEl}
    use:observeOverflow
    role="tablist"
    aria-label={pane === "left" ? "Tabs" : "Right pane tabs"}
    class="flex flex-1 overflow-x-auto overflow-y-hidden min-w-0 h-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
  >
    {#each tabList as tab, i (tabKey(tab))}
      {@const isActive = i === activeIndex}
      {@const isSource = isDragging && dragSrcIdx === i}
      {@const isTarget = isDragging && dropIdx === i}
      {@const Icon = getIcon(tab.type)}
      <!-- The chip is layout and drag; the tab itself is the menu's trigger, so the
           keyboard's menu key (Shift+F10, ≣) lands where the menu listens. It used to be
           this outer element, and the key reached nothing (2026-10 design review). -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        data-tab-chip
        data-tab-pane={pane}
        data-tab-index={i.toString()}
        class={[
          "min-w-36 max-w-[12.5rem] flex-1 flex h-full relative border-r border-sidebar-border/40 touch-none",
          isActive ? "-mb-px" : "",
          isSource ? "opacity-50" : "",
          isTarget ? "ring-inset ring-1 ring-primary/60" : "",
        ].join(" ")}
        onpointerdown={(e) => onChipPointerDown(e, i)}
        onpointermove={(e) => onChipPointerMove(e, i)}
        onpointerup={(e) => onChipPointerUp(e, i)}
        onpointercancel={clearDrag}
      >
        <ContextMenu.Root>
          <ContextMenu.Trigger
            role="tab"
            aria-selected={isActive}
            title={tab.type === "template" ? `${tab.title} (template)` : tab.title}
            tabindex={isActive ? 0 : -1}
            onclick={() => tabs.activateTab(pane, i)}
            onkeydown={(e: KeyboardEvent) => onTabKeydown(e, i)}
            class={[
              "flex items-center gap-1.5 px-3 h-full w-full cursor-pointer select-none group",
              isActive
                ? "bg-background text-foreground border-b-2 border-b-primary"
                : "bg-sidebar text-muted-foreground hover:bg-surface-hover hover:text-foreground",
            ].join(" ")}
            onauxclick={(e) => {
              if (e.button === 2) return;
              tabs.closeTab(pane, i);
            }}
          >
            <Icon class="size-3.5 shrink-0" />
            <!-- A template says so by its icon and its full name on hover. A "Template"
                 label beside the name left a narrow tab room for three letters of it. -->
            <MiddleTruncate text={tab.title} class="text-sm flex-1" />
            {#if tab.type === "template"}<span class="sr-only">, template</span>{/if}
            <button
              type="button"
              class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 ml-auto shrink-0 size-4 flex items-center justify-center rounded text-muted-foreground hover:bg-hover-overlay hover:text-foreground transition-opacity"
              onclick={(e) => {
                e.stopPropagation();
                tabs.closeTab(pane, i);
              }}
              aria-label="Close tab"
            >
              <X class="size-3" />
            </button>
          </ContextMenu.Trigger>
          <ContextMenu.Content>
            <ContextMenu.Item onSelect={() => tabs.closeTab(pane, i)}>
              <X />
              Close
              <!-- The key closes the active tab, so it is only this row's key on that one. -->
              {#if isActive}<ContextMenu.Shortcut>{shortcut(["W"])}</ContextMenu.Shortcut>{/if}
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={() => tabs.closeOthers(pane, i)}>
              <CopyX />
              Close others
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={() => tabs.closeAll(pane)}>
              <ListX />
              Close all
            </ContextMenu.Item>
            <ContextMenu.Separator />
            {#if pane === "left"}
              <ContextMenu.Item onSelect={() => tabs.moveToOtherPane("left", i)}>
                <PanelRightOpen />
                Move to right pane
              </ContextMenu.Item>
            {:else}
              <ContextMenu.Item onSelect={() => tabs.moveToOtherPane("right", i)}>
                <PanelLeftOpen />
                Move to left pane
              </ContextMenu.Item>
            {/if}
          </ContextMenu.Content>
        </ContextMenu.Root>
      </div>
    {/each}
  </div>

  <!-- New tab button -->
  <button
    type="button"
    class="flex items-center justify-center h-(--tab-bar-h) w-8 border-l border-sidebar-border bg-background text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors shrink-0"
    onclick={() => tabs.addEmptyTab(pane)}
    aria-label="New tab"
  >
    <Plus class="size-3.5" />
  </button>

  <!-- Every tab, when they no longer fit: a menu like any other (it was a list of
       its own, with no menu roles and hover in the card colour). -->
  {#if hasOverflow}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class="flex items-center justify-center h-(--tab-bar-h) w-8 border-l border-sidebar-border bg-background text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors shrink-0"
        aria-label="Show all tabs"
      >
        <ChevronRight class="size-4" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="min-w-[180px] max-w-72">
        {#each tabList as tab, i (tabKey(tab))}
          {@const Icon = getIcon(tab.type)}
          <DropdownMenu.Item
            aria-current={i === activeIndex ? "page" : undefined}
            class={i === activeIndex ? "bg-surface-selected text-foreground" : ""}
            onSelect={() => tabs.activateTab(pane, i)}
          >
            <Icon />
            <MiddleTruncate text={tab.title} />
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {/if}
</div>

<!-- Drag ghost: follows cursor, pointer-events:none so elementsFromPoint skips it -->
{#if isDragging && dragSrcIdx >= 0 && dragSrcIdx < tabList.length}
  {@const GhostIcon = getIcon(tabList[dragSrcIdx].type)}
  <div
    class="fixed pointer-events-none z-9999 flex items-center gap-1.5 px-3 py-1 rounded border border-primary/40 bg-background/95 text-sm text-foreground -translate-x-1/2"
    style="left: {ghostX}px; top: {ghostY - 36}px"
  >
    <GhostIcon class="size-3.5 shrink-0" />
    {tabList[dragSrcIdx].title}
  </div>
{/if}
