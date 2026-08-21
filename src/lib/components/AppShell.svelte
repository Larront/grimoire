<script lang="ts">
  import AppSidebar from "./sidebar/AppSidebar.svelte";
  import SettingsDialog from "./SettingsDialog.svelte";
  import TagManagerDialog from "./TagManagerDialog.svelte";
  import FailedImportsDialog from "./FailedImportsDialog.svelte";
  import UnlinkedPinsDialog from "./UnlinkedPinsDialog.svelte";
  import SearchPalette from "./SearchPalette.svelte";
  import QuickNoteDialog from "./QuickNoteDialog.svelte";
  import TabBar from "./TabBar.svelte";
  import PaneContent from "./PaneContent.svelte";
  import SampleBanner from "./SampleBanner.svelte";
  import SampleEffects from "./SampleEffects.svelte";
  import * as Sidebar from "./ui/sidebar";
  import { paneSurface } from "$lib/details/pane-detail-surface.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { dialogs } from "$lib/stores/overlay.svelte";
  import { ledger, failedImportsModal, unlinkedPinsModal } from "$lib/stores/ledger.svelte";
  import { createUntitledNoteAtRoot } from "$lib/utils/note-actions";
  import { isTypingIn } from "$lib/utils/keyboard";
  import { readSidebarOpen, persistSidebarOpen } from "$lib/utils/sidebar-state";
  import PanelRightIcon from "@lucide/svelte/icons/panel-right";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";

  // Each pane owns its own detail surface (ADR-0006 §1); the shell only renders
  // the trigger for it. Whether there is one to render is the surface's answer,
  // not a tab-type test here: a pane's content claims a toggleable surface when
  // it has one, so adding a pane type never means editing this file.
  const leftSurface = paneSurface("left");
  const rightSurface = paneSurface("right");

  // Collapsed-or-expanded is the shell's to remember, not the generated
  // provider's. Read once here, at the same moment `SidebarState`'s constructor
  // reads the width, so the strip is painted in its remembered state rather than
  // settling into it (#226).
  let sidebarOpen = $state(readSidebarOpen());

  // The palette's _Create note_ path, unchanged (#227). The GM has been told by
  // the toast the write already raised; this is the shell, with nowhere of its
  // own to say it again.
  async function createNote() {
    try {
      await createUntitledNoteAtRoot();
    } catch (e) {
      console.error("create_note failed:", e);
    }
  }
</script>

{#snippet navButtons(pane: "left" | "right")}
  <div class="flex items-center shrink-0 gap-0.5 px-1">
    <button
      onclick={() => tabs.navigateBack(pane)}
      disabled={!tabs.canGoBack(pane)}
      class="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
      aria-label="Go back"
    >
      <ArrowLeftIcon class="size-3.5" />
    </button>
    <button
      onclick={() => tabs.navigateForward(pane)}
      disabled={!tabs.canGoForward(pane)}
      class="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
      aria-label="Go forward"
    >
      <ArrowRightIcon class="size-3.5" />
    </button>
  </div>
{/snippet}

<svelte:window
  onkeydown={(e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "w") {
      e.preventDefault();
      tabs.closeActiveTab();
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "n") {
      // `Ctrl+N` without a modifier is emacs-style "next line" in a native text
      // field, so where the GM is typing it already means something and this
      // stays out of the way. `Cmd+N` means nothing there, and is the binding a
      // Mac GM's hands know, so it fires wherever they are. Shift is the [[Quick
      // Notes Dialog]]'s (#231), and belongs to it alone.
      if (e.ctrlKey && !e.metaKey && isTypingIn(e.target)) return;
      // Silent with no ledger open, matching Ctrl/Cmd+Shift+N — no toast
      // explaining that a world is required.
      if (!ledger.isOpen) return;
      e.preventDefault();
      void createNote();
    }
  }}
/>
<!-- No rail, and no offset for one: the sidebar collapses to the strip that used
     to be `IconRail`, at the same 3rem, in the same place (#226). -->
<div class="relative">
  <Sidebar.Provider bind:open={sidebarOpen} onOpenChange={persistSidebarOpen}>
    <SettingsDialog bind:open={dialogs.settingsOpen} />
    <TagManagerDialog bind:open={dialogs.tagManagerOpen} />
    <FailedImportsDialog
      bind:open={failedImportsModal.open}
      failures={failedImportsModal.failures}
    />
    <UnlinkedPinsDialog bind:open={unlinkedPinsModal.open} pins={unlinkedPinsModal.pins} />
    <SearchPalette />
    <QuickNoteDialog />
    <SampleEffects />
    <div class="flex min-h-svh flex-1">
      <AppSidebar />
      <main class="flex min-w-0 flex-1 flex-col">
        <Sidebar.Inset>
          <!-- Split pane content area -->
          <div class="flex flex-1 min-h-0 overflow-hidden">
            <!-- Left pane (always present) -->
            <div class="relative flex flex-col flex-1 min-w-0 min-h-0" role="none">
              <SampleBanner />
              <div class="flex items-center border-b border-sidebar-border">
                <div class="flex items-center shrink-0 h-(--tab-bar-h) pl-1">
                  <Sidebar.Trigger class="-ml-1" />
                </div>
                {@render navButtons("left")}
                <TabBar pane="left" />
                {#if leftSurface.toggleable}
                  <div class="ml-auto shrink-0 px-2">
                    <button
                      data-testid="left-rail-trigger"
                      onclick={leftSurface.toggle}
                      class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label="Toggle details panel"
                    >
                      <PanelRightIcon class="size-4" />
                    </button>
                  </div>
                {/if}
              </div>
              <PaneContent pane="left" />

              <!-- Full-height split drop zone at the right edge, always in DOM
                   so elementsFromPoint finds data-pane-content="right" even when
                   the cursor is at tab-bar height. Visual only shown while dragging. -->
              {#if tabs.right === null}
                <div
                  data-pane-content="right"
                  class={[
                    "absolute inset-y-0 right-0 w-24 z-50 pointer-events-none flex flex-col items-center justify-center",
                    tabs.dragging !== null
                      ? "border-l-2 border-dashed border-primary/40 bg-primary/5"
                      : "",
                  ].join(" ")}
                >
                  {#if tabs.dragging !== null}
                    <span
                      class="text-xs text-primary/70 font-medium select-none [writing-mode:vertical-rl] rotate-180"
                    >
                      Drop to split
                    </span>
                  {/if}
                </div>
              {/if}
            </div>

            <!-- Right pane (conditional) -->
            {#if tabs.right !== null}
              <div class="w-px bg-sidebar-border shrink-0"></div>
              <div class="flex flex-col flex-1 min-w-0 min-h-0" role="none">
                <div class="flex items-center border-b border-sidebar-border">
                  {@render navButtons("right")}
                  <TabBar pane="right" />
                  {#if rightSurface.toggleable}
                    <div class="ml-auto shrink-0 px-2">
                      <button
                        data-testid="right-rail-trigger"
                        onclick={rightSurface.toggle}
                        class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        aria-label="Toggle details panel"
                      >
                        <PanelRightIcon class="size-4" />
                      </button>
                    </div>
                  {/if}
                </div>
                <PaneContent pane="right" />
              </div>
            {/if}
          </div>
        </Sidebar.Inset>
      </main>
    </div>
  </Sidebar.Provider>
</div>
