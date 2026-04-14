<script lang="ts">
  import { invoke, convertFileSrc } from "@tauri-apps/api/core";
  import { AlignLeft, AlignCenter, AlignRight } from "@lucide/svelte";

  let {
    src,
    alt,
    align,
    width,
    onUpdate,
  }: {
    src: string;
    alt: string;
    align: string;
    width: string;
    onUpdate: (attrs: { align: string; width: string }) => void;
  } = $props();

  // Internal mutable copies — NodeView calls setAttrs / setSelected to update these
  // svelte-ignore state_referenced_locally
  let _align = $state(align);
  // svelte-ignore state_referenced_locally
  let _width = $state(width);
  // svelte-ignore state_referenced_locally
  let _src = $state(src);
  // svelte-ignore state_referenced_locally
  let _alt = $state(alt);
  let _selected = $state(false);

  let imageUrl = $state<string | null>(null);
  let loadError = $state(false);
  let containerEl: HTMLDivElement | undefined = $state();

  export function setAttrs(newAlign: string, newWidth: string, newSrc: string, newAlt: string) {
    _align = newAlign;
    _width = newWidth;
    _src = newSrc;
    _alt = newAlt;
  }

  export function setSelected(val: boolean) {
    _selected = val;
  }

  $effect(() => {
    imageUrl = null;
    loadError = false;
    invoke<string>("get_image_absolute_path", { relativePath: _src })
      .then((abs) => {
        imageUrl = convertFileSrc(abs);
      })
      .catch(() => {
        loadError = true;
      });
  });

  const justifyMap: Record<string, string> = {
    left: "flex-start",
    center: "center",
    right: "flex-end",
  };

  // Resize state — tracked here AND in the extension's stopEvent closure
  // via a 'resizing' data attribute on the dom root
  let isDragging = false;
  let dragStartX = 0;
  let dragStartWidthPx = 0;

  function startResize(e: MouseEvent) {
    e.preventDefault();
    isDragging = true;
    dragStartX = e.clientX;
    const parent = containerEl?.parentElement;
    dragStartWidthPx = parent
      ? parent.offsetWidth * (parseFloat(_width) / 100)
      : 200;
    // Signal to stopEvent in the extension that a resize is in progress
    containerEl?.closest("[data-image-block]")?.setAttribute("data-resizing", "");

    function onMove(e: MouseEvent) {
      if (!isDragging || !containerEl?.parentElement) return;
      const delta = e.clientX - dragStartX;
      const newPx = Math.max(80, dragStartWidthPx + delta);
      const pct = Math.min(
        100,
        Math.round((newPx / containerEl.parentElement.offsetWidth) * 100),
      );
      _width = `${pct}%`;
    }

    function onUp() {
      isDragging = false;
      containerEl
        ?.closest("[data-image-block]")
        ?.removeAttribute("data-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      onUpdate({ align: _align, width: _width });
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="my-2 flex"
  style="justify-content: {justifyMap[_align] ?? 'center'};"
>
  <div
    bind:this={containerEl}
    class="relative"
    style="width: {_width};"
  >
    {#if _selected}
      <!-- Floating toolbar -->
      <div
        class="absolute -top-8 left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5
               rounded border border-border bg-card shadow-md px-1 py-0.5"
      >
        <button
          class="p-1 rounded hover:bg-muted text-muted-foreground/60 hover:text-foreground
                 transition-colors {_align === 'left' ? 'text-primary' : ''}"
          aria-label="Align left"
          aria-pressed={_align === "left"}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => {
            _align = "left";
            onUpdate({ align: "left", width: _width });
          }}
        >
          <AlignLeft size={14} />
        </button>
        <button
          class="p-1 rounded hover:bg-muted text-muted-foreground/60 hover:text-foreground
                 transition-colors {_align === 'center' ? 'text-primary' : ''}"
          aria-label="Align center"
          aria-pressed={_align === "center"}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => {
            _align = "center";
            onUpdate({ align: "center", width: _width });
          }}
        >
          <AlignCenter size={14} />
        </button>
        <button
          class="p-1 rounded hover:bg-muted text-muted-foreground/60 hover:text-foreground
                 transition-colors {_align === 'right' ? 'text-primary' : ''}"
          aria-label="Align right"
          aria-pressed={_align === "right"}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => {
            _align = "right";
            onUpdate({ align: "right", width: _width });
          }}
        >
          <AlignRight size={14} />
        </button>
      </div>
    {/if}

    {#if imageUrl}
      <img
        src={imageUrl}
        alt={_alt}
        class="block w-full rounded"
        draggable="false"
      />
    {:else if loadError}
      <div
        class="flex items-center justify-center w-full h-20 rounded border border-border/60
               bg-card text-muted-foreground/60 text-xs font-sans"
      >
        Image not found: {_src}
      </div>
    {:else}
      <div class="w-full h-20 rounded bg-card animate-pulse"></div>
    {/if}

    {#if _selected}
      <!-- Bottom-right resize handle -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        role="separator"
        class="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize
               bg-card border border-border rounded-tl z-10"
        aria-label="Resize image"
        onmousedown={startResize}
      ></div>
    {/if}
  </div>
</div>
