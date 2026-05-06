import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import Skeleton from '../lib/components/ui/skeleton/skeleton.svelte';

describe('Skeleton', () => {
	it('uses --background-elevated token as shimmer base', () => {
		const { container } = render(Skeleton);
		const el = container.querySelector('[data-slot="skeleton"]') as HTMLElement;
		expect(el).toBeTruthy();
		// class should reference background-elevated, not bg-muted
		expect(el.className).toMatch(/background-elevated/);
	});
});
