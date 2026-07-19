<script lang="ts">
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";
	import { useSidebar } from "./context.svelte.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLButtonElement>, HTMLButtonElement> = $props();

	const sidebar = useSidebar();

	// The rail doubles as a drag-to-resize handle (#140). While expanded, a press
	// that stays put toggles (collapse) and a press that moves resizes; both are
	// resolved in pointerup, because pointer-capture + preventDefault can suppress
	// the native click in WebView2. While collapsed, pointerdown bails before
	// preventDefault so the native click still fires and opens the sidebar.
	// Left sidebar only: dragging right widens it.
	let startX = 0;
	let startWidth = 0;
	let moved = false;
	// Set after pointerup handles an expanded press, so any click the browser
	// still emits doesn't toggle a second time. Reset on every new pointerdown
	// so a swallowed-but-never-fired click can't stick and eat the next one.
	let suppressClick = false;

	function onpointerdown(e: PointerEvent) {
		suppressClick = false;
		// Only the primary button, and never while collapsed or on mobile — there
		// the rail is purely a toggle, handled by the native click below.
		if (e.button !== 0 || sidebar.isMobile || !sidebar.open) return;
		startX = e.clientX;
		startWidth = sidebar.width;
		moved = false;
		sidebar.setResizing(true);
		ref?.setPointerCapture(e.pointerId);
		e.preventDefault();
	}

	function onpointermove(e: PointerEvent) {
		if (!sidebar.resizing) return;
		const dx = e.clientX - startX;
		if (Math.abs(dx) > 3) moved = true;
		sidebar.setWidth(startWidth + dx);
	}

	function onpointerup(e: PointerEvent) {
		if (!sidebar.resizing) return;
		sidebar.setResizing(false);
		ref?.releasePointerCapture(e.pointerId);
		if (moved) sidebar.persistWidth();
		else sidebar.toggle();
		suppressClick = true;
	}

	function onclick() {
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		// Reached only when pointerdown bailed (collapsed / mobile): open it.
		sidebar.toggle();
	}
</script>

<button
	bind:this={ref}
	data-sidebar="rail"
	data-slot="sidebar-rail"
	aria-label="Toggle Sidebar"
	tabindex={-1}
	{onpointerdown}
	{onpointermove}
	{onpointerup}
	{onclick}
	title="Drag to resize · click to toggle"
	class={cn(
		"hover:after:bg-sidebar-border absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] sm:flex",
		"in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
		"[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
		"hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full",
		"[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
		"[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</button>
