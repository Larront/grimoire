<script lang="ts">
  /*
    A colour picker for a colour the GM chooses for something they made: a saturation and
    brightness square, a hue strip, a hex field, and a way back to having chosen nothing.

    It reports twice. `oninput` fires on every movement, so the thing being coloured can
    follow the drag; `onchange` fires once, when the GM lets go, a key settles, or a hex is
    entered — that is where a caller saves. Saving on every pointer move would write the
    ledger sixty times a second.

    Nothing here is themed: the value is data, kept as `#rrggbb`, and does not move when
    the GM changes accent or mode (see `entity-colors.ts`).
  */
  import { untrack } from "svelte";
  import { hexToHsv, hsvToHex, normalizeHex, storedColorHex, type Hsv } from "$lib/color";
  import { DEFAULT_PIN_COLOR } from "$lib/entity-colors";

  interface Props {
    /** The stored colour (hex, or an older `rgb()`), or null when none is chosen. */
    value: string | null;
    /** What the Default button chooses: null to clear (a scene, a pin that inherits its
        category's colour), or a colour for things that always have one (annotations). */
    defaultValue?: string | null;
    /** Where the square and strip sit while nothing is chosen — what null looks like. */
    fallback?: string;
    /** The swatch shown while nothing is chosen. Neutral iron unless null means a
        colour (a pin with no colour of its own wears its fallback). */
    noneSwatch?: string;
    defaultLabel?: string;
    oninput?: (hex: string) => void;
    onchange: (hex: string | null) => void;
  }

  let {
    value: stored,
    defaultValue = null,
    fallback = DEFAULT_PIN_COLOR,
    noneSwatch = "var(--background-elevated)",
    defaultLabel = "Default",
    oninput,
    onchange,
  }: Props = $props();

  const value = $derived(storedColorHex(stored));
  const isDefault = $derived(
    defaultValue === null ? value === null : value === storedColorHex(defaultValue),
  );

  // Seeded once; the effect below keeps it following `value` from then on.
  let hsv = $state<Hsv>(hexToHsv(untrack(() => value ?? normalizeHex(fallback) ?? DEFAULT_PIN_COLOR)));
  let dragging = $state(false);
  const hex = $derived(hsvToHex(hsv));

  // A colour handed to `onchange` and not yet back as `value`. Until the caller's save
  // lands, `value` is still the old colour, and following it would snap the handle back
  // for a moment. Released after a while regardless, so a failed save cannot leave the
  // picker deaf to its value.
  let pending = $state<string | null>(null);
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  // Follow a value that changes from outside (another surface, an undo) — but not while
  // the GM is dragging, and not when it is the colour already shown: re-deriving HSV from
  // a hex loses the hue of a grey, and the strip would jump to red under their hand.
  $effect(() => {
    const next = normalizeHex(value ?? fallback);
    if (!next || dragging) return;
    if (pending !== null) {
      if (value === pending) pending = null;
      return;
    }
    if (untrack(() => hex) !== next) hsv = hexToHsv(next);
  });

  function emitInput() {
    oninput?.(hsvToHex(hsv));
  }

  function commit() {
    const next = hsvToHex(hsv);
    if (next === value) return;
    pending = next;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => (pending = null), 2000);
    onchange(next);
  }

  // Keys move in small steps and settle before saving, so holding an arrow is one write.
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  function commitSoon() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(commit, 350);
  }

  // ---- Saturation × brightness square ----
  let area = $state<HTMLDivElement | null>(null);

  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

  function setFromPointer(e: PointerEvent) {
    if (!area) return;
    const r = area.getBoundingClientRect();
    hsv = {
      ...hsv,
      s: clamp01((e.clientX - r.left) / r.width),
      v: 1 - clamp01((e.clientY - r.top) / r.height),
    };
    emitInput();
  }

  function onAreaPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    dragging = true;
    area?.setPointerCapture(e.pointerId);
    area?.focus();
    setFromPointer(e);
  }

  function onAreaPointerUp() {
    if (!dragging) return;
    dragging = false;
    commit();
  }

  function onAreaKeydown(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowDown: [0, -step],
      ArrowUp: [0, step],
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    hsv = { ...hsv, s: clamp01(hsv.s + move[0]), v: clamp01(hsv.v + move[1]) };
    emitInput();
    commitSoon();
  }

  // ---- Hex field ----
  let hexDraft = $state<string | null>(null);
  const hexInvalid = $derived(hexDraft !== null && normalizeHex(hexDraft) === null);

  function commitHex() {
    if (hexDraft === null) return;
    const next = normalizeHex(hexDraft);
    hexDraft = null;
    if (!next || next === hex) return;
    hsv = hexToHsv(next);
    emitInput();
    commit();
  }
</script>

<div data-color-picker class="flex flex-col gap-2.5">
  <!-- Saturation runs left to right, brightness bottom to top, over the strip's hue. -->
  <div
    bind:this={area}
    role="slider"
    tabindex="0"
    aria-label="Saturation and brightness"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(hsv.s * 100)}
    aria-valuetext="Saturation {Math.round(hsv.s * 100)}%, brightness {Math.round(hsv.v * 100)}%"
    class="relative h-28 w-full cursor-crosshair touch-none rounded-md
           focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    style="background:
      linear-gradient(to top, #000, rgb(0 0 0 / 0)),
      linear-gradient(to right, #fff, rgb(255 255 255 / 0)),
      hsl({hsv.h} 100% 50%)"
    onpointerdown={onAreaPointerDown}
    onpointermove={(e) => dragging && setFromPointer(e)}
    onpointerup={onAreaPointerUp}
    onpointercancel={onAreaPointerUp}
    onkeydown={onAreaKeydown}
  >
    <div
      class="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ring-1 ring-black/40"
      style="left: {hsv.s * 100}%; top: {(1 - hsv.v) * 100}%; background: {hex}"
    ></div>
  </div>

  <input
    type="range"
    min="0"
    max="359"
    step="1"
    value={Math.round(hsv.h)}
    aria-label="Hue"
    class="hue-slider w-full"
    oninput={(e) => {
      hsv = { ...hsv, h: parseFloat((e.target as HTMLInputElement).value) };
      emitInput();
    }}
    onchange={commit}
  />

  <div class="flex items-center gap-2">
    <span
      class="size-7 shrink-0 rounded-md border border-border"
      style="background: {value === null ? noneSwatch : hex}"
      aria-hidden="true"
    ></span>
    <input
      type="text"
      spellcheck="false"
      aria-label="Hex colour"
      aria-invalid={hexInvalid}
      value={hexDraft ?? (value === null ? "" : hex)}
      placeholder={hex}
      maxlength={7}
      class="h-8 w-24 rounded-md border bg-transparent px-2 font-mono text-[11px] text-foreground uppercase
             placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring
             {hexInvalid ? 'border-error' : 'border-border'}"
      oninput={(e) => (hexDraft = (e.target as HTMLInputElement).value)}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitHex();
        } else if (e.key === "Escape" && hexDraft !== null) {
          e.stopPropagation();
          hexDraft = null;
        }
      }}
      onblur={commitHex}
    />
    <button
      type="button"
      data-color-default
      aria-pressed={isDefault}
      class="ml-auto inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium transition-colors
             focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring
             {isDefault
        ? 'bg-primary/12 text-foreground ring-1 ring-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
      onclick={() => {
        if (!isDefault) onchange(defaultValue === null ? null : storedColorHex(defaultValue));
      }}
    >
      {defaultLabel}
    </button>
  </div>
</div>
