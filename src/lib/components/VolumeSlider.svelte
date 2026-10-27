<script lang="ts">
  /*
    The one volume slider, for every surface that sets a level: the scene editor, the
    in-note player, the mini player and the PDF scene-link bubble. Each used to draw its
    own copy of the same idea, and the copies had drifted — one had a handle, some had
    a name for screen readers, the editor's had neither.

    THE REAL INPUT IS INVISIBLE ON PURPOSE. It sits over a drawn track at opacity 0 and
    is the only thing the pointer touches; the track, fill and handle beneath it are
    pictures of its value. That arrangement is what keeps several sliders over the same
    level — the master volume is on screen in up to four places — in step and grabbable,
    and it stays.

    What the copies got wrong was the input's size. `app.css` styles every range input
    `height: 3px` from a selector that outranks a utility class, so `h-full` lost and the
    invisible input was 3px tall: grabbable only because the 10px native thumb overhangs
    it. The height is set inline here, so the whole row-height strip is the target.

    Its fill is crimson only while the audio it sets is playing (`active`) — DESIGN.md's
    Signal Rule lists *playing* among the five things the accent means, and a level is
    not one of them. At rest it is neutral, so a stopped mixer is quiet and a playing one
    shows which lines are sounding.
  */
  import { cn } from "$lib/utils.js";

  interface Props {
    /** 0–1. */
    value: number;
    /** The accessible name — say what it sets: "Master volume", "Heavy Rain volume". */
    label: string;
    /** The audio this slider sets is playing. */
    active?: boolean;
    oninput: (value: number) => void;
    /** Fires once on release — where a caller saves. */
    onchange?: (value: number) => void;
    class?: string;
  }

  let { value, label, active = false, oninput, onchange, class: className }: Props = $props();

  const percent = $derived(Math.round(value * 100));

  function read(e: Event): number {
    return parseFloat((e.target as HTMLInputElement).value);
  }
</script>

<div data-slot="volume-slider" class={cn("relative flex h-5 w-20 shrink-0 items-center", className)}>
  <input
    type="range"
    min="0"
    max="1"
    step="0.01"
    {value}
    class="peer absolute inset-0 w-full cursor-pointer opacity-0"
    style="height: 100%"
    aria-label={label}
    aria-valuetext="{percent}%"
    oninput={(e) => oninput(read(e))}
    onchange={onchange ? (e) => onchange(read(e)) : undefined}
  />
  <!-- `width` and `left` here are a deliberate exception to DESIGN.md's rule against
       animating layout properties, and the reason is that both alternatives are worse.
       `scaleX` on the fill squashes the pill's rounded ends as it grows — a visible defect
       traded for an invisible saving. Driving the handle by `transform` needs the offset in
       pixels, which means measuring the track every frame to avoid animating `left`. The
       rule is about panels and drawers sweeping across the pane; this is a 4px-tall bar
       inside its own containing block, animating for 75ms while a GM drags a slider. -->
  <div
    class="pointer-events-none relative h-1 w-full rounded-full bg-foreground/10
           peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring"
    aria-hidden="true"
  >
    <div
      class="absolute inset-y-0 left-0 rounded-full transition-colors
             {active ? 'bg-primary' : 'bg-foreground/35'}"
      style="width: {value * 100}%"
    ></div>
    <div
      class="absolute top-1/2 size-3 -translate-y-1/2 rounded-full transition-colors
             {active ? 'bg-primary' : 'bg-foreground/80'}"
      style="left: calc({value * 100}% - 6px)"
    ></div>
  </div>
</div>
