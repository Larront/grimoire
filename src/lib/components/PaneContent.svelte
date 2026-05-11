<script lang="ts">
	import { tabs, type Tab } from '$lib/stores/tabs.svelte';
	import NotePane from './panes/NotePane.svelte';
	import MapPane from './panes/MapPane.svelte';
	import ScenePane from './panes/ScenePane.svelte';
	import ScenesDashboard from './panes/ScenesDashboard.svelte';

	interface Props {
		pane: 'left' | 'right';
	}

	let { pane }: Props = $props();

	const tabPane = $derived(pane === 'left' ? tabs.left : tabs.right);
	const activeTab = $derived(tabPane?.tabs[tabPane?.activeIndex ?? 0] ?? null);
	const activeIndex = $derived(tabPane?.activeIndex ?? 0);
</script>

<div
	data-pane-content={pane}
	class="relative flex flex-1 min-h-0 flex-col overflow-hidden"
	onclick={() => tabs.setFocusedPane(pane)}
	role="none"
>
	{#if !activeTab || activeTab.type === 'empty'}
		<div class="flex flex-1 items-center justify-center text-muted-foreground">
			<div class="text-center space-y-2">
				<p class="text-sm font-medium">No tab open</p>
				<p class="text-xs text-muted-foreground/60">Open a note, map, or scene from the sidebar</p>
			</div>
		</div>
	{:else if activeTab.type === 'note'}
		{#key activeTab.id}
			<NotePane
				noteId={activeTab.id}
				rename={activeTab.rename}
				{pane}
				tabIndex={activeIndex}
			/>
		{/key}
	{:else if activeTab.type === 'map'}
		{#key activeTab.id}
			<MapPane mapId={activeTab.id} {pane} />
		{/key}
	{:else if activeTab.type === 'scenes'}
		<ScenesDashboard />
	{:else if activeTab.type === 'scene'}
		{#key activeTab.id}
			<ScenePane sceneId={activeTab.id} {pane} />
		{/key}
	{/if}

	<!-- Drop zone overlay when the other pane already exists -->
	{#if tabs.dragging && tabs.dragging.pane !== pane}
		<div
			class="absolute inset-0 z-50 border-2 border-dashed border-primary/50 bg-primary/5 flex items-center justify-center pointer-events-none"
		>
			<span class="text-sm text-primary font-medium">
				Drop to {pane === 'right' ? 'move to left pane' : 'open in right pane'}
			</span>
		</div>
	{/if}
</div>
