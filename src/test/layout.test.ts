import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import Layout from '../routes/+layout.svelte';

describe('root layout', () => {
	it('mounts without errors', () => {
		const { container } = render(Layout);
		expect(container).toBeTruthy();
	});

	it('includes ModeWatcher configured for dark-first', async () => {
		render(Layout);
		// ModeWatcher sets defaultMode="dark" — on first mount with no stored
		// preference it should apply the dark class to the document root.
		expect(document.documentElement.classList.contains('dark')).toBe(true);
	});

	it('mounts a Toaster for toast notifications', () => {
		render(Layout);
		// svelte-sonner renders a <section aria-live="polite" aria-label="Notifications ...">
		const toaster = document.querySelector('section[aria-live="polite"]');
		expect(toaster).toBeTruthy();
	});
});
