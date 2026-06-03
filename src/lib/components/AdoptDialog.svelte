<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Folder, LoaderCircle } from "@lucide/svelte";
  import { ledger } from "$lib/stores/ledger.svelte";
  import { open } from "@tauri-apps/plugin-dialog";

  let { open: dialogOpen = $bindable(false) }: { open: boolean } = $props();

  let name = $state("");
  let parent = $state<string | null>(null);
  let nameError = $state<string | null>(null);
  let isAdopting = $state(false);
  let isPickingLocation = $state(false);

  function reset() {
    name = "";
    parent = null;
    nameError = null;
    isAdopting = false;
    isPickingLocation = false;
  }

  function validate(): boolean {
    const trimmed = name.trim();

    if (!trimmed) {
      nameError = "Please enter a ledger name.";
      return false;
    }
    if (/[/\\:*?"<>|]/.test(trimmed)) {
      nameError = 'Name contains invalid characters ( / \\ : * ? " < > | ).';
      return false;
    }
    if (trimmed === "." || trimmed === "..") {
      nameError = "Invalid ledger name.";
      return false;
    }
    if (!parent) {
      nameError = "Please choose a storage location.";
      return false;
    }

    nameError = null;
    return true;
  }

  async function handleChooseLocation() {
    isPickingLocation = true;
    try {
      const selected = await open({
        directory: true,
        title: "Choose Location",
      });
      if (selected && typeof selected === "string") {
        parent = selected;
        if (nameError === "Please choose a storage location.") nameError = null;
      }
    } finally {
      isPickingLocation = false;
    }
  }

  async function handleConfirm() {
    if (!validate()) return;
    isAdopting = true;
    try {
      await ledger.adopt(parent!, name.trim());
      dialogOpen = false;
      reset();
    } finally {
      isAdopting = false;
    }
  }

  function handleCancel() {
    reset();
    dialogOpen = false;
  }
</script>

<Dialog.Root bind:open={dialogOpen} onOpenChange={(v) => { if (!v) reset(); }}>
  <Dialog.Content showCloseButton={false}>
    <div data-testid="adopt-dialog" class="flex flex-col gap-5">
      <Dialog.Header>
        <Dialog.Title>Make This World Mine</Dialog.Title>
        <Dialog.Description>
          Copy this example world to your own location and make it yours to edit freely.
        </Dialog.Description>
      </Dialog.Header>

      <div class="flex flex-col gap-3">
        <!-- Name field -->
        <div class="flex flex-col gap-1.5">
          <label
            for="adopt-name"
            class="font-sans text-[11px] text-muted-foreground"
          >
            Name
          </label>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            id="adopt-name"
            type="text"
            placeholder="My World"
            bind:value={name}
            autofocus
            disabled={isAdopting}
            onkeydown={(e) => {
              if (e.key === "Enter") handleConfirm();
              if (e.key === "Escape") handleCancel();
            }}
            class="h-9 px-3 rounded-[6px] bg-(--hover-overlay) border border-border
                   text-[13px] text-foreground placeholder:text-foreground-faint
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary
                   focus-visible:ring-offset-1 focus-visible:ring-offset-background
                   disabled:opacity-50 w-full"
          />
        </div>

        <!-- Location field -->
        <div class="flex flex-col gap-1.5">
          <span class="font-sans text-[11px] text-muted-foreground">Location</span>
          <button
            type="button"
            data-testid="adopt-choose-location-btn"
            onclick={handleChooseLocation}
            disabled={isAdopting || isPickingLocation}
            class="h-9 px-3 rounded-[6px] bg-(--hover-overlay) border border-border
                   flex items-center gap-2 text-left w-full min-w-0
                   hover:bg-(--background-elevated) transition-colors duration-150
                   disabled:opacity-50 cursor-default"
          >
            <Folder class="w-3.5 h-3.5 shrink-0 text-muted-foreground/70" />
            {#if parent}
              <span class="font-sans text-[12px] text-foreground truncate min-w-0">
                {parent}
              </span>
            {:else}
              <span class="font-sans text-[12px] text-foreground/30 italic">
                Choose location...
              </span>
            {/if}
          </button>
        </div>

        <!-- Validation error -->
        {#if nameError}
          <p
            class="font-sans text-[11px] text-destructive leading-snug"
            role="alert"
          >
            {nameError}
          </p>
        {/if}
      </div>

      <Dialog.Footer>
        <Button
          variant="ghost"
          size="sm"
          onclick={handleCancel}
          disabled={isAdopting}
          class="text-[11px] text-muted-foreground"
        >
          Cancel
        </Button>
        <Button
          data-testid="adopt-confirm-btn"
          size="sm"
          onclick={handleConfirm}
          disabled={isAdopting || !name.trim() || !parent}
          class="text-[11px]"
        >
          {#if isAdopting}
            <LoaderCircle class="w-3 h-3 animate-spin mr-1.5" />
            Adopting...
          {:else}
            Make It Mine
          {/if}
        </Button>
      </Dialog.Footer>
    </div>
  </Dialog.Content>
</Dialog.Root>
