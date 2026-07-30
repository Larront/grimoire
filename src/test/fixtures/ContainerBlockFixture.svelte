<script lang="ts">
  // A stand-in container Note Block view for the node-view connector's tests:
  // block-owned chrome around a hole whose children ProseMirror owns. Callout is
  // the real consumer this shape is built for (ADR-0016 §5).
  let { title = "" }: { title?: string } = $props();

  // svelte-ignore state_referenced_locally
  let _title = $state(title);

  export function setAttrs(attrs: { title: string }) {
    _title = attrs.title;
  }
</script>

<header data-fixture-title>{_title}</header>
<div data-node-view-content></div>
