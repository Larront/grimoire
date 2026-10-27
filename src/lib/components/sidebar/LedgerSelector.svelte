<script lang="ts">
  /*
    The open world, at the foot of the sidebar, and the way to another.

    One control in every world (2026-10 design review). In the example it used to be
    replaced by an "Example World" marker and Make this world mine, which left a GM no
    way back to their own worlds but a folder picker. Now the example keeps the same
    menu — the recent worlds — with Make this world mine added, and is named as itself,
    "The Ashfen Vale", marked as an example. Neutral throughout: the accent is reserved
    for selection, focus, the primary action and what is playing, and "you are in the
    example" is none of those.

    It is also where the world says what needs the GM's attention — pins that lost
    their note, notes that couldn't be opened, links to notes moved outside Grimoire —
    which were three lasting toasts until the same review. A quiet mark on the button
    says something is waiting; the menu says what. A menu like any other now
    (`DropdownMenu`), where it was a list of its own with no arrow keys.
  */
  import { dialogs } from "$lib/stores/overlay.svelte";
  import {
    ChevronDown,
    FileWarning,
    FolderInput,
    FolderOpen,
    Heart,
    Link2Off,
    MapPinOff,
  } from "@lucide/svelte";
  import { ledger, type RecentLedger } from "$lib/stores/ledger.svelte";
  import { needsAttention, type AttentionKind } from "$lib/stores/needs-attention.svelte";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { buttonVariants } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";

  let open = $state(false);
  let recentLedgers = $state<RecentLedger[]>([]);

  const ICONS: Record<AttentionKind, typeof FolderOpen> = {
    pins: MapPinOff,
    notes: FileWarning,
    links: Link2Off,
  };

  async function onOpenChange(next: boolean) {
    open = next;
    if (next) {
      // Missing folders (moved/unmounted) are Splash concerns — a quick-switch
      // menu only lists worlds that can actually open.
      recentLedgers = (await ledger.getRecentLedgers()).filter(
        (v) => !v.missing && v.path !== ledger.path,
      );
    }
  }

  async function switchLedger(path: string) {
    try {
      await ledger.openLedger(path);
    } catch (e) {
      console.error("open ledger failed:", e);
    }
  }

  async function openNewLedger() {
    try {
      await ledger.openLedger();
    } catch (e) {
      console.error("open ledger failed:", e);
    }
  }

  const waiting = $derived(needsAttention.count);
</script>

<DropdownMenu.Root bind:open {onOpenChange}>
  <DropdownMenu.Trigger
    aria-label="World: {ledger.worldName}{ledger.isSample ? ', an example' : ''}{waiting
      ? ', needs attention'
      : ''}"
    data-testid={ledger.isSample ? "sample-world-marker" : undefined}
    class={cn(
      buttonVariants({ variant: "ghost", size: "sm" }),
      "w-full justify-start gap-2 px-2 text-left",
    )}
  >
    <FolderOpen class="size-3.5 shrink-0 text-muted-foreground" />
    <span class="min-w-0 flex-1 truncate text-(length:--font-ui)" title={ledger.worldName}
      >{ledger.worldName}</span
    >
    {#if ledger.isSample}
      <span class="shrink-0 text-(length:--font-ui) text-muted-foreground">example</span>
    {/if}
    {#if waiting}
      <!-- Something waits in the menu. Neutral: needing attention is none of the
           things the accent means, and it is not a failure. -->
      <span
        data-testid="world-needs-attention"
        class="size-1.5 shrink-0 rounded-full bg-foreground"
        aria-hidden="true"
      ></span>
    {/if}
    <ChevronDown
      class={cn(
        "size-3 shrink-0 text-muted-foreground transition-transform duration-150",
        open && "rotate-180",
      )}
    />
  </DropdownMenu.Trigger>

  <DropdownMenu.Content side="top" align="start" class="w-64">
    {#if needsAttention.items.length}
      <div class="px-2 pt-1.5 pb-1 text-xs font-semibold text-muted-foreground">
        Needs attention
      </div>
      {#each needsAttention.items as item (item.key)}
        {@const Icon = ICONS[item.kind]}
        <!-- The row does its one thing, so it says what that is: choosing a moved
             note's row rewrites links, and must not look like it only shows them.
             Leaving them is on the World Home, beside it. -->
        <DropdownMenu.Item data-testid="attention-{item.kind}" onSelect={() => void item.action.run()}>
          <Icon />
          <span class="flex min-w-0 flex-1 flex-col">
            <span>{item.label}</span>
            <span class="text-xs text-muted-foreground">{item.action.label}</span>
          </span>
        </DropdownMenu.Item>
      {/each}
      <DropdownMenu.Separator />
    {/if}

    {#if ledger.isSample}
      <DropdownMenu.Item data-testid="make-mine-btn" onSelect={() => (dialogs.adoptOpen = true)}>
        <Heart />
        Make this world mine
      </DropdownMenu.Item>
      <DropdownMenu.Separator />
    {/if}

    {#each recentLedgers as v (v.path)}
      <DropdownMenu.Item onSelect={() => void switchLedger(v.path)}>
        <FolderOpen />
        <span class="truncate">{v.name}</span>
      </DropdownMenu.Item>
    {/each}

    {#if recentLedgers.length > 0}
      <DropdownMenu.Separator />
    {/if}

    <DropdownMenu.Item onSelect={() => void openNewLedger()}>
      <FolderInput />
      Open a world folder…
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
