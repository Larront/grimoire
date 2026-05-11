<script lang="ts">
	import { tabs } from '$lib/stores/tabs.svelte';
	import { FileText, Map as MapIcon, Music2, Clapperboard, ChevronRight, X, Plus, File } from '@lucide/svelte';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import type { TabType } from '$lib/stores/tabs.svelte';

	interface Props {
		pane: 'left' | 'right';
	}

	let { pane }: Props = $props();

	const tabPane = $derived(pane === 'left' ? tabs.left : tabs.right);
	const tabList = $derived(tabPane?.tabs ?? []);
	const activeIndex = $derived(tabPane?.activeIndex ?? 0);

	let hasOverflow = $state(false);
	let dropdownOpen = $state(false);

	// ── Pointer-based drag ────────────────────────────────────────────────────
	// Using pointer events + setPointerCapture instead of HTML5 DnD, which does
	// not work reliably in Tauri's WebView2 (OS-level drag intercepts dragover).

	let isDragging = $state(false);
	let dragSrcIdx = $state(-1);
	let ghostX = $state(0);
	let ghostY = $state(0);
	let dropIdx = $state<number | null>(null);   // same-pane reorder target
	let crossPaneDrop = $state(false);           // cursor is over the other pane

	// Non-reactive: start position for dead-zone check
	let _startX = 0;
	let _startY = 0;

	function onChipPointerDown(e: PointerEvent, i: number) {
		if (e.button !== 0) return;
		if ((e.target as HTMLElement).closest('button')) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		dragSrcIdx = i;
		_startX = e.clientX;
		_startY = e.clientY;
	}

	function onChipPointerMove(e: PointerEvent, i: number) {
		if (dragSrcIdx !== i) return;

		const dx = e.clientX - _startX;
		const dy = e.clientY - _startY;
		if (!isDragging && dx * dx + dy * dy < 25) return; // 5 px dead zone

		isDragging = true;
		ghostX = e.clientX;
		ghostY = e.clientY;
		tabs.setDragging({ pane, index: i });

		const otherPane = pane === 'left' ? 'right' : 'left';

		// Use getBoundingClientRect instead of elementsFromPoint for cross-pane
		// detection — absolutely-positioned pointer-events:none elements are
		// skipped by elementsFromPoint in Chromium/WebView2.
		const otherPaneEl = document.querySelector(`[data-pane-content="${otherPane}"]`) as HTMLElement | null;
		if (otherPaneEl) {
			const r = otherPaneEl.getBoundingClientRect();
			if (e.clientX >= r.left && e.clientX <= r.right &&
				e.clientY >= r.top && e.clientY <= r.bottom) {
				crossPaneDrop = true;
				dropIdx = null;
				return;
			}
		}

		crossPaneDrop = false;

		const els = document.elementsFromPoint(e.clientX, e.clientY);
		const sameChip = els.find(
			(el) => el.hasAttribute('data-tab-chip') && el.getAttribute('data-tab-pane') === pane
		) as HTMLElement | undefined;

		if (sameChip) {
			const idx = parseInt(sameChip.dataset.tabIndex ?? '-1', 10);
			dropIdx = !isNaN(idx) && idx !== i ? idx : null;
		} else {
			dropIdx = null;
		}
	}

	function onChipPointerUp(e: PointerEvent, i: number) {
		if (dragSrcIdx !== i) return;
		if (isDragging) {
			if (dropIdx !== null) {
				tabs.reorderTab(pane, i, dropIdx);
			} else if (crossPaneDrop) {
				tabs.moveToOtherPane(pane, i);
			}
		}
		clearDrag();
	}

	function clearDrag() {
		isDragging = false;
		dragSrcIdx = -1;
		dropIdx = null;
		crossPaneDrop = false;
		tabs.setDragging(null);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	function getIcon(type: TabType) {
		switch (type) {
			case 'note':   return FileText;
			case 'map':    return MapIcon;
			case 'scenes': return Clapperboard;
			case 'scene':  return Music2;
			case 'empty':  return File;
		}
	}

	function observeOverflow(node: HTMLElement) {
		const observer = new ResizeObserver(() => {
			hasOverflow = node.scrollWidth > node.clientWidth;
		});
		observer.observe(node);
		return { destroy() { observer.disconnect(); } };
	}

	function clickOutside(node: HTMLElement) {
		function handleClick(e: MouseEvent) {
			if (!node.contains(e.target as Node)) dropdownOpen = false;
		}
		document.addEventListener('click', handleClick, true);
		return { destroy() { document.removeEventListener('click', handleClick, true); } };
	}
</script>

<div
	class="flex h-(--tab-bar-h) shrink-0 items-center border-b border-sidebar-border bg-background overflow-hidden"
>
	<div use:observeOverflow class="flex flex-1 overflow-hidden min-w-0 h-full">
		{#each tabList as tab, i (tab.id + tab.type)}
			{@const isActive = i === activeIndex}
			{@const isSource = isDragging && dragSrcIdx === i}
			{@const isTarget = isDragging && dropIdx === i}
			{@const Icon = getIcon(tab.type)}
			<div
				role="tab"
				aria-selected={isActive}
				tabindex={isActive ? 0 : -1}
				data-tab-chip
				data-tab-pane={pane}
				data-tab-index={i.toString()}
				class={[
					'min-w-[80px] max-w-[200px] flex-1 flex h-full relative border-r border-sidebar-border/40 touch-none',
					isActive  ? '-mb-px' : '',
					isSource  ? 'opacity-50' : '',
					isTarget  ? 'ring-inset ring-1 ring-primary/60' : ''
				].join(' ')}
				onclick={() => tabs.activateTab(pane, i)}
				onpointerdown={(e) => onChipPointerDown(e, i)}
				onpointermove={(e) => onChipPointerMove(e, i)}
				onpointerup={(e) => onChipPointerUp(e, i)}
				onpointercancel={clearDrag}
			>
				<ContextMenu.Root>
					<ContextMenu.Trigger
						class={[
							'flex items-center gap-1.5 px-3 h-full w-full cursor-pointer select-none group',
							isActive
								? 'bg-background text-foreground border-b-2 border-b-primary'
								: 'bg-sidebar text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
						].join(' ')}
						onauxclick={(e) => {
							if (e.button === 2) return;
							tabs.closeTab(pane, i);
						}}
					>
						<Icon class="size-3.5 shrink-0" />
						<span class="truncate text-sm flex-1">{tab.title}</span>
						<button
							type="button"
							class="opacity-0 group-hover:opacity-100 ml-auto shrink-0 size-4 flex items-center justify-center rounded hover:bg-destructive/20 hover:text-destructive transition-opacity"
							onclick={(e) => {
								e.stopPropagation();
								tabs.closeTab(pane, i);
							}}
							aria-label="Close tab"
						>
							<X class="size-3" />
						</button>
					</ContextMenu.Trigger>
					<ContextMenu.Content>
						<ContextMenu.Item onSelect={() => tabs.closeTab(pane, i)}>Close</ContextMenu.Item>
						<ContextMenu.Item onSelect={() => tabs.closeOthers(pane, i)}>Close Others</ContextMenu.Item>
						<ContextMenu.Item onSelect={() => tabs.closeAll(pane)}>Close All</ContextMenu.Item>
						<ContextMenu.Separator />
						{#if pane === 'left'}
							<ContextMenu.Item onSelect={() => tabs.moveToOtherPane('left', i)}>Move to Right Pane</ContextMenu.Item>
						{:else}
							<ContextMenu.Item onSelect={() => tabs.moveToOtherPane('right', i)}>Move to Left Pane</ContextMenu.Item>
						{/if}
					</ContextMenu.Content>
				</ContextMenu.Root>
			</div>
		{/each}
	</div>

	<!-- New tab button -->
	<button
		type="button"
		class="flex items-center justify-center h-(--tab-bar-h) w-8 border-l border-sidebar-border bg-background text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors shrink-0"
		onclick={() => tabs.addEmptyTab(pane)}
		aria-label="New tab"
	>
		<Plus class="size-3.5" />
	</button>

	<!-- Chevron overflow button -->
	{#if hasOverflow}
		<div use:clickOutside class="relative shrink-0">
			<button
				type="button"
				class="flex items-center justify-center h-(--tab-bar-h) w-8 border-l border-sidebar-border bg-background text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors shrink-0"
				onclick={() => (dropdownOpen = !dropdownOpen)}
				aria-label="Show all tabs"
			>
				<ChevronRight class="size-4" />
			</button>
			{#if dropdownOpen}
				<div
					class="absolute right-0 top-full z-50 min-w-[180px] rounded-lg border border-sidebar-border bg-popover text-popover-foreground shadow-md p-1"
				>
					{#each tabList as tab, i (tab.id + tab.type)}
						{@const Icon = getIcon(tab.type)}
						<button
							type="button"
							class={[
								'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md cursor-pointer',
								i === activeIndex
									? 'bg-accent text-accent-foreground'
									: 'hover:bg-accent hover:text-accent-foreground text-popover-foreground'
							].join(' ')}
							onclick={() => {
								tabs.activateTab(pane, i);
								dropdownOpen = false;
							}}
						>
							<Icon class="size-3.5 shrink-0" />
							<span class="truncate flex-1 text-left">{tab.title}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- Drag ghost: follows cursor, pointer-events:none so elementsFromPoint skips it -->
{#if isDragging && dragSrcIdx >= 0 && dragSrcIdx < tabList.length}
	{@const GhostIcon = getIcon(tabList[dragSrcIdx].type)}
	<div
		class="fixed pointer-events-none z-9999 flex items-center gap-1.5 px-3 py-1 rounded border border-primary/40 bg-background/95 shadow-lg text-sm text-foreground -translate-x-1/2"
		style="left: {ghostX}px; top: {ghostY - 36}px"
	>
		<GhostIcon class="size-3.5 shrink-0" />
		{tabList[dragSrcIdx].title}
	</div>
{/if}
