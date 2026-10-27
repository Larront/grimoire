<script lang="ts">
  /*
    The Splash's layout: two columns, chosen by the owner from three tried in the
    running app (2026-10 design review).

    The window is wide, so it is used. On the left, what Grimoire is and the ways to
    start. On the right, the GM's own world: the one last opened is the subject — its
    name at Title size, what is in it, and Continue, focused so a launch and Enter put
    the GM back at their table — and the others are a list beneath it, in the list
    voice. The first time, the right side is the example world instead, said in its own
    words, because what is inside it is the reason to open it.
  */
  import type { Snippet } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { ArrowRight, FolderOpen, LoaderCircle, Plus } from "@lucide/svelte";
  import WorldRow from "./WorldRow.svelte";
  import { timeAgo, worldContents } from "$lib/utils/world-words";
  import type { SplashProps } from "./splash";

  let p: SplashProps & {
    /** The create form, drawn in the right-hand column in place of the worlds. */
    create?: Snippet;
  } = $props();

  /** The world to continue: the most recent one whose folder can be found. */
  const last = $derived(p.worlds.find((w) => !w.missing) ?? null);
  const others = $derived(p.worlds.filter((w) => w !== last));
</script>

{#snippet exampleLinks()}
  <button
    type="button"
    class="underline decoration-border underline-offset-2 hover:text-foreground"
    data-testid="splash-explore-sample"
    disabled={p.busy !== null}
    onclick={p.exampleSaved ? p.onContinueExample : p.onExplore}
    >{p.exampleSaved ? "Continue the example world" : "Wander the example world"}</button
  >
  {#if p.exampleSaved}
    ·
    <button
      type="button"
      class="underline decoration-border underline-offset-2 hover:text-foreground"
      disabled={p.busy !== null}
      onclick={p.onExplore}>start it over</button
    >
  {/if}
{/snippet}

<div
  class="mx-auto grid w-full max-w-[64rem] grid-cols-[minmax(0,20rem)_minmax(0,1fr)] gap-x-14 px-10 pt-[16vh] pb-12
         [@media(max-height:720px)]:pt-10"
>
  <div class="flex flex-col splash-fade">
    <h1 class="font-heading text-[2.75rem] leading-none text-primary">Grimoire</h1>
    <p class="mt-5 text-(length:--font-body) leading-relaxed text-foreground-muted">
      A spellbook of record for the world you're building: notes, maps and the sound of the
      room, linked to one another, in a folder you own.
    </p>

    <div class="-ms-2.5 mt-10 flex flex-col items-start gap-1">
      <Button variant="ghost" class="gap-2 text-foreground" data-splash-new onclick={p.onNewWorld}>
        <Plus /> New world
      </Button>
      <Button
        variant="ghost"
        class="gap-2 text-foreground"
        disabled={p.busy !== null}
        onclick={p.onOpenFolder}
      >
        {#if p.busy === "__folder__"}<LoaderCircle class="animate-spin" />{:else}<FolderOpen />{/if}
        Open a world folder…
      </Button>
    </div>

    {#if p.worlds.length}
      <p class="mt-8 text-(length:--font-ui) text-foreground-muted">
        {@render exampleLinks()}
      </p>
    {/if}
  </div>

  <div class="min-w-0 border-l border-border ps-12 splash-fade-delay-1">
    {#if p.create}
      {@render p.create()}
    {:else if last}
      <section aria-labelledby="splash-last">
        <!-- Three lines at most: a name past that is cut, whole on hover. -->
        <h2
          id="splash-last"
          class="line-clamp-3 font-heading text-[2.75rem] leading-[1.15] tracking-tight text-foreground text-balance"
          title={last.name}
        >
          {last.name}
        </h2>
        <p class="mt-3 text-(length:--font-body) text-foreground-muted">
          {worldContents(last)} · last opened {timeAgo(last.last_opened)}
        </p>
        <Button
          size="lg"
          class="mt-7 h-10 gap-2 px-4 text-sm"
          disabled={p.busy !== null}
          data-splash-primary
          onclick={() => p.onOpen(last.path)}
        >
          {#if p.busy === last.path}<LoaderCircle class="animate-spin" />{/if}
          Continue
          <ArrowRight data-icon="inline-end" />
        </Button>
      </section>
    {:else if !p.worlds.length}
      <section aria-labelledby="splash-example">
        <h2
          id="splash-example"
          class="font-heading text-[2.75rem] leading-[1.15] tracking-tight text-foreground"
        >
          The Ashfen Vale
        </h2>
        <p class="mt-3 text-(length:--font-body) italic text-foreground-muted">
          An example world: a fog-bound corner of somebody else's.
        </p>
        <p class="mt-5 max-w-[30rem] text-(length:--font-body) leading-relaxed text-foreground-muted">
          A small campaign to wander before you start your own: notes that link to one another, a
          map with its pins, scenes to play at the table, a timeline, and a thought parked for
          later. Change anything — it's a copy.
        </p>
        <Button
          size="lg"
          class="mt-7 h-10 gap-2 px-4 text-sm"
          disabled={p.busy !== null}
          data-splash-primary
          onclick={p.exampleSaved ? p.onContinueExample : p.onExplore}
        >
          {#if p.busy === "__example__"}<LoaderCircle class="animate-spin" />{/if}
          {p.exampleSaved ? "Continue exploring" : "Explore it"}
          <ArrowRight data-icon="inline-end" />
        </Button>
        {#if p.exampleSaved}
          <button
            type="button"
            class="mt-3 block text-(length:--font-ui) text-foreground-muted underline decoration-border underline-offset-2 hover:text-foreground"
            disabled={p.busy !== null}
            onclick={p.onExplore}>Start it over</button
          >
        {/if}
      </section>
    {/if}

    {#if others.length && !p.create}
      <section class={last ? "mt-12" : ""} aria-labelledby="splash-others">
        <h2 id="splash-others" class="text-xs font-semibold text-foreground-muted">
          {last ? "Other worlds" : "Your worlds"}
        </h2>
        <!-- Pulled out by the rows' own padding, so names line up with the one above. -->
        <ul data-pane-scroll class="-mx-3 mt-2 flex max-h-[34vh] flex-col overflow-y-auto">
          {#each others as world (world.path)}
            <WorldRow
              {world}
              busy={p.busy}
              onOpen={p.onOpen}
              onRemove={p.onRemove}
              onLookAgain={p.onLookAgain}
              onFind={p.onFind}
              nameClass="text-(length:--font-body)"
            />
          {/each}
        </ul>
      </section>
    {/if}
  </div>
</div>
