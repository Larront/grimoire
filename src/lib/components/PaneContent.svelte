<script lang="ts">
	import { tabs, type Tab } from '$lib/stores/tabs.svelte';
	import { notes } from '$lib/stores/notes.svelte';
	import type { RightRailState } from '$lib/stores/right-rail.svelte';
	import LedgerHome from './panes/LedgerHome.svelte';
	import NotePane from './panes/NotePane.svelte';
	import MapPane from './panes/MapPane.svelte';
	import ScenePane from './panes/ScenePane.svelte';
	import ScenesDashboard from './panes/ScenesDashboard.svelte';
	import TemplatePane from './panes/TemplatePane.svelte';
	import GraphPane from './panes/GraphPane.svelte';
	import PdfPane from './panes/PdfPane.svelte';

	interface Props {
		pane: 'left' | 'right';
		rail?: RightRailState;
	}

	let { pane, rail }: Props = $props();

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
		{#if !notes.isLoading && notes.noteCount === 0}
			<!-- Brand-new ledger: first-note home instead of the bare placeholder -->
			<LedgerHome />
		{:else}
			<div class="flex flex-1 items-center justify-center text-muted-foreground">
				<div class="text-center space-y-2">
					<p class="text-sm font-medium">No tab open</p>
					<p class="text-xs text-muted-foreground/60">Open a note, map, or scene from the sidebar</p>
				</div>
			</div>
		{/if}
	{:else if activeTab.type === 'note'}
		{#key activeTab.id}
			<NotePane
				noteId={activeTab.id}
				rename={activeTab.rename}
				{pane}
				tabIndex={activeIndex}
				{rail}
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
	{:else if activeTab.type === 'template' && activeTab.templatePath}
		{#key activeTab.templatePath}
			<TemplatePane
				templatePath={activeTab.templatePath}
				templateTitle={activeTab.title}
			/>
		{/key}
	{:else if activeTab.type === 'pdf' && activeTab.pdfPath}
		{#key activeTab.pdfPath}
			<PdfPane pdfPath={activeTab.pdfPath} pdfTitle={activeTab.title} {pane} />
		{/key}
	{:else if activeTab.type === 'graph'}
		<GraphPane />
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
