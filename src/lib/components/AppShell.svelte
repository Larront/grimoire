<script>
  import { Pane, PaneGroup, PaneResizer } from "paneforge";

  const { children } = $props();

</script>
<PaneGroup direction="horizontal">
	<Pane defaultSize={20} minSize={14}>Pane 1</Pane>
	<PaneResizer />
	<Pane defaultSize={80}>{@render children()}</Pane>
</PaneGroup>