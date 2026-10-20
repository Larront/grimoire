<script lang="ts">
  // An on/off setting (2026-10 design review). Three copies of one hand-written switch lived
  // in Settings and the Tag Manager, all filling crimson when on — and the Signal Rule names
  // "toggles in Settings" as one of the things that stay neutral. Off, the track was the
  // border token on a raised panel, 1.3:1, and its knob a hole darker than the track.
  //
  // On is the text colour filled in, as a statblock's ticked box is; off is an outline with
  // a muted knob. Neither spends crimson, and both read at 3:1 or better on either theme.
  import type { HTMLButtonAttributes } from "svelte/elements";

  let {
    checked,
    onCheckedChange,
    class: className = "",
    ...rest
  }: {
    checked: boolean;
    onCheckedChange: (next: boolean) => void;
    class?: string;
  } & Omit<HTMLButtonAttributes, "onclick" | "role" | "type"> = $props();
</script>

<button
  {...rest}
  type="button"
  role="switch"
  aria-checked={checked}
  data-state={checked ? "checked" : "unchecked"}
  onclick={() => onCheckedChange(!checked)}
  class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors
         motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring
         {checked ? 'border-foreground bg-foreground' : 'border-foreground-muted/70 bg-transparent'}
         {className}"
>
  <span
    class="pointer-events-none inline-block size-3.5 rounded-full transition-transform motion-reduce:transition-none
           {checked ? 'translate-x-[18px] bg-background' : 'translate-x-[2px] bg-foreground-muted'}"
  ></span>
</button>
