import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { SceneWithCount } from '../lib/types/vault';

vi.mock('$lib/toast', () => ({
	toastUndo: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

import { toastUndo } from '$lib/toast';
import { scenes } from '../lib/stores/scenes.svelte';
import ScenePage from '../routes/scene/+page.svelte';

describe('Scene grid skeleton', () => {
	it('shows Skeleton elements while scenes are loading', async () => {
		// Never resolve so isLoading stays true
		vi.mocked(invoke).mockImplementation(async (cmd: string) => {
			if (cmd === 'get_scenes_with_slot_counts') return new Promise(() => {});
			return null;
		});

		// Trigger the loading state via the store directly
		const loadPromise = scenes.load();
		const { container } = render(ScenePage);

		await waitFor(() => {
			const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
			if (skeletons.length === 0) throw new Error('No skeletons found');
			return skeletons;
		});

		expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
		loadPromise.catch(() => {});
	});
});

const mockScenes: SceneWithCount[] = [
	{ id: 1, name: 'Tavern Night', favorited: 0, created_at: '2025-01-01T00:00:00Z', slot_count: 2 },
];

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('Scene page delete', () => {
	beforeEach(async () => {
		vi.mocked(invoke).mockImplementation(async (cmd: string) => {
			if (cmd === 'get_scenes_with_slot_counts') return mockScenes;
			return null;
		});
		await scenes.load();
	});

	it('triggers undo toast instead of opening AlertDialog', async () => {
		const { container } = render(ScenePage);

		const sceneCard = await waitFor(() => {
			const el = container.querySelector('[data-slot="context-menu-trigger"]');
			if (!el) throw new Error('Scene card not found');
			return el;
		});

		await fireEvent.contextMenu(sceneCard);

		const deleteItem = await waitFor(() => {
			const items = Array.from(document.body.querySelectorAll('[data-slot="context-menu-item"]'));
			const item = items.find((el) => el.textContent?.includes('Delete')) as HTMLElement | undefined;
			if (!item) throw new Error('Delete menu item not found');
			return item;
		});

		await fireEvent.click(deleteItem);

		expect(toastUndo).toHaveBeenCalledWith(
			expect.stringContaining('Tavern Night'),
			expect.any(Function),
		);
		expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
	});
});
