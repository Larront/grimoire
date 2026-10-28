<!--
  @component
  An image whose file is gone — moved or deleted outside Grimoire, which the GM may do
  at any time — and the one way back: Replace. The Image block and the Infobox's
  thumbnail both draw it.

  It used to print the raw ledger path in 12px at under 3:1 and, behind it, the app's
  generic "Something went wrong — please try again", which no retry could fix. It says
  what happened, names the file it was looking for, and offers the fix.
-->
<script lang="ts">
  import { ImageOff } from "@lucide/svelte";

  let {
    path,
    onReplace,
    compact = false,
  }: {
    /** The ledger-relative path the image pointed at. */
    path: string;
    onReplace: () => void;
    /** A thumbnail-sized notice: tighter, for the Infobox. */
    compact?: boolean;
  } = $props();

  const fileName = $derived(path.split("/").pop() || path);
</script>

<div
  data-image-missing
  class="flex w-full flex-col items-center justify-center rounded-md border border-dashed border-border
         bg-card text-center font-sans text-muted-foreground {compact
    ? 'min-h-16 gap-1.5 px-2 py-2'
    : 'min-h-24 gap-2 px-3 py-4'}"
>
  <ImageOff size={compact ? 16 : 20} aria-hidden="true" />
  <!-- Divs, not paragraphs: inside a note the editor spaces every paragraph. -->
  <div class="text-sm text-foreground">This image was moved or deleted</div>
  <div class="max-w-full break-all font-mono text-[11px]" title={path}>{fileName}</div>
  <button
    type="button"
    data-replace-btn
    class="mt-0.5 inline-flex h-7 items-center rounded-md border border-border bg-background px-2.5 text-xs
           text-foreground transition-colors hover:bg-surface-hover cursor-pointer
           focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
    onmousedown={(e) => e.preventDefault()}
    onclick={onReplace}
  >
    Replace…
  </button>
</div>
