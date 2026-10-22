<script lang="ts">
  /*
    Name and location for a new world — the Splash's create form and the Adopt dialog.

    One part rather than two copies (2026-10 design review): the two had the same
    markup pasted, so every fix had to be made twice, and the dialog's copy had lost
    the fixed width that kept a long path from pushing its buttons off the card.

    - Problems show under the field they are about, once the GM has tried to go on,
      and follow the typing from then on — a message about an empty name used to stay
      after the name was typed.
    - Once there is a name and a folder, a line says where the world will live. The
      folder chosen is the *parent*: a GM who made "Ashfen" in the picker and chose it
      got Ashfen\Ashfen, and nothing said so.
  */
  import { open as pickFolder } from "@tauri-apps/plugin-dialog";
  import { CircleX, Folder } from "@lucide/svelte";
  import { NO_LOCATION, ledgerDestination, nameProblem, shortPath } from "$lib/utils/ledger-name";

  let {
    name = $bindable(""),
    parent = $bindable(null),
    placeholder,
    disabled = false,
    attempted = false,
    nameRefused = null,
    onSubmit,
    onCancel,
  }: {
    name?: string;
    parent?: string | null;
    placeholder: string;
    disabled?: boolean;
    /** Whether the GM has tried to go on — problems are shown from then. */
    attempted?: boolean;
    /** A refusal from the backend about this name in this folder (it already exists). */
    nameRefused?: string | null;
    onSubmit: () => void;
    onCancel?: () => void;
  } = $props();

  const id = $props.id();
  let picking = $state(false);

  const nameError = $derived((attempted ? nameProblem(name) : null) ?? nameRefused);
  const locationError = $derived(attempted && !parent ? NO_LOCATION : null);
  const destination = $derived(
    parent && !nameProblem(name) ? ledgerDestination(parent, name) : null,
  );

  async function chooseLocation() {
    picking = true;
    try {
      const selected = await pickFolder({ directory: true, title: "Choose where to save it" });
      if (selected && typeof selected === "string") parent = selected;
    } finally {
      picking = false;
    }
  }

  const field = `h-8 w-full min-w-0 rounded-md border border-border bg-background px-2.5
                 text-(length:--font-ui) text-foreground placeholder:text-muted-foreground
                 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring
                 aria-invalid:border-error disabled:opacity-50`;
</script>

{#snippet problem(text: string, errorId: string)}
  <p id={errorId} class="flex items-start gap-1.5 text-(length:--font-ui) text-error">
    <CircleX size={14} class="mt-0.5 shrink-0" aria-hidden="true" />
    {text}
  </p>
{/snippet}

<div class="flex min-w-0 flex-col gap-3">
  <div class="flex min-w-0 flex-col gap-1.5">
    <label for="{id}-name" class="text-xs font-semibold text-muted-foreground">Name</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      id="{id}-name"
      type="text"
      autocomplete="off"
      {placeholder}
      bind:value={name}
      autofocus
      {disabled}
      aria-invalid={!!nameError}
      aria-describedby={nameError ? `${id}-name-error` : undefined}
      onkeydown={(e) => {
        if (e.key === "Enter") onSubmit();
        if (e.key === "Escape") onCancel?.();
      }}
      class={field}
    />
    {#if nameError}{@render problem(nameError, `${id}-name-error`)}{/if}
  </div>

  <div class="flex min-w-0 flex-col gap-1.5">
    <span id="{id}-location" class="text-xs font-semibold text-muted-foreground">Location</span>
    <button
      type="button"
      data-testid="new-ledger-location"
      onclick={chooseLocation}
      disabled={disabled || picking}
      aria-labelledby="{id}-location {id}-location-value"
      data-invalid={locationError ? "" : undefined}
      aria-describedby={locationError
        ? `${id}-location-error`
        : destination
          ? `${id}-destination`
          : undefined}
      class="{field} flex cursor-pointer items-center gap-2 text-left hover:bg-surface-hover
             disabled:cursor-default data-invalid:border-error"
    >
      <Folder class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span
        id="{id}-location-value"
        class="min-w-0 flex-1 truncate {parent ? 'text-foreground' : 'text-muted-foreground'}"
        title={parent ?? undefined}>{parent ? shortPath(parent) : "Choose a folder…"}</span
      >
      {#if parent}
        <span class="shrink-0 text-muted-foreground">Change…</span>
      {/if}
    </button>
    {#if locationError}
      {@render problem(locationError, `${id}-location-error`)}
    {:else if destination}
      <p
        id="{id}-destination"
        data-testid="new-ledger-destination"
        class="truncate font-mono text-[11px] text-muted-foreground"
        title={destination}
      >
        Saved as {shortPath(destination)}
      </p>
    {/if}
  </div>
</div>
