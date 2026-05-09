<script lang="ts">
  interface Props {
    path: string;
    title: string;
    content: string;
    x: number;
    y: number;
  }

  let { path, title, content, x, y }: Props = $props();

  const preview = $derived(
    content.trim().slice(0, 280) + (content.trim().length > 280 ? "…" : ""),
  );
</script>

<div
  class="fixed z-100 w-72 overflow-hidden rounded-lg border border-border
         bg-popover shadow-xl shadow-black/40 pointer-events-none"
  style="left: {x}px; top: {y}px;"
  role="tooltip"
>
  <div class="px-3.5 pt-3 pb-1.5 border-b border-border/60">
    <div class="font-heading text-sm leading-tight text-foreground">{title}</div>
    <div class="font-sans text-[0.65rem] text-muted-foreground/50 truncate mt-0.5">{path}</div>
  </div>
  <div class="px-3.5 py-2.5">
    <p
      class="font-sans text-[0.75rem] leading-relaxed text-muted-foreground
             whitespace-pre-wrap line-clamp-5"
    >
      {preview}
    </p>
  </div>
</div>
