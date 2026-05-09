<script lang="ts">
  import IconRail from "./sidebar/IconRail.svelte";
  import AppSidebar from "./sidebar/AppSidebar.svelte";
  import RightRail from "./RightRail.svelte";
  import SettingsDialog from "./SettingsDialog.svelte";
  import TabBar from "./TabBar.svelte";
  import PaneContent from "./PaneContent.svelte";
  import * as Sidebar from "./ui/sidebar";
  import { RightRailState } from "$lib/stores/right-rail.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import PanelRightIcon from "@lucide/svelte/icons/panel-right";

  const rail = new RightRailState();
  let settingsOpen = $state(false);
</script>

<!--
  --rail-w sets the fixed sidebar container's left offset so it sits flush
  against the icon rail. The ml-12 wrapper pushes the flex content area
  right by the same amount so nothing slides under the rail.
-->
<svelte:window
  onkeydown={(e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
      e.preventDefault();
      tabs.closeActiveTab();
    }
  }}
/>
<div class="relative" style="--rail-w: 3rem">
  <Sidebar.Provider>
    <IconRail
      onFilesClick={() => {}}
      onScenesClick={() => {}}
      onSettingsClick={() => (settingsOpen = true)}
    />
    <SettingsDialog bind:open={settingsOpen} />
    <div class="ml-12 flex min-h-svh flex-1">
      <AppSidebar />
      <main class="flex min-w-0 flex-1 flex-col">
        <Sidebar.Inset>
          <!-- Split pane content area -->
          <div class="flex flex-1 min-h-0 overflow-hidden">
            <!-- Left pane (always present) -->
            <div
              class="relative flex flex-col flex-1 min-w-0 min-h-0"
              role="none"
            >
              <div class="flex items-center border-b border-sidebar-border">
                <div class="flex items-center shrink-0 h-(--tab-bar-h) pl-1">
                  <Sidebar.Trigger class="-ml-1" />
                </div>
                <TabBar pane="left" />
                {#if tabs.focusedPane === 'left'}
                  <div class="ml-auto shrink-0 px-2">
                    <button
                      data-testid="right-rail-trigger"
                      onclick={rail.toggle}
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
                    'absolute inset-y-0 right-0 w-24 z-50 pointer-events-none flex flex-col items-center justify-center',
                    tabs.dragging !== null ? 'border-l-2 border-dashed border-primary/40 bg-primary/5' : ''
                  ].join(' ')}
                >
                  {#if tabs.dragging !== null}
                    <span class="text-xs text-primary/70 font-medium select-none [writing-mode:vertical-rl] rotate-180">
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
                  <TabBar pane="right" />
                  {#if tabs.focusedPane === 'right'}
                    <div class="ml-auto shrink-0 px-2">
                      <button
                        data-testid="right-rail-trigger"
                        onclick={rail.toggle}
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
      <RightRail {rail} />
    </div>
  </Sidebar.Provider>
</div>
