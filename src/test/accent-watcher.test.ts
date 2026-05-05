import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { setMode, resetMode } from 'mode-watcher';
import { flushSync } from 'svelte';
import { invoke } from '@tauri-apps/api/core';
import AccentWatcher from '../lib/components/AccentWatcher.svelte';
import { vault } from '../lib/stores/vault.svelte';

afterEach(() => {
	cleanup();
	vault.setAccent('accent-crimson');
	document.documentElement.style.cssText = '';
	document.documentElement.className = '';
});

describe('vault store — accent persistence', () => {
	afterEach(() => vault.setAccent('accent-crimson'));

	it('calls invoke save_accent_preset when preset changes', () => {
		const invokeSpy = vi.mocked(invoke);
		invokeSpy.mockClear();
		vault.setAccent('accent-amber');
		expect(invokeSpy).toHaveBeenCalledWith('save_accent_preset', { preset: 'accent-amber' });
	});

	it('restores saved accent preset on checkExistingVault', async () => {
		vi.mocked(invoke).mockImplementation(async (cmd: string) => {
			if (cmd === 'get_vault_path') return '/some/vault';
			if (cmd === 'get_accent_preset') return 'accent-arcane';
			return null;
		});
		await vault.checkExistingVault();
		expect(vault.accent).toBe('accent-arcane');
		vi.mocked(invoke).mockResolvedValue(null);
	});
});

describe('AccentWatcher — dark mode (default)', () => {
	it('applies crimson --primary inline style on root', () => {
		render(AccentWatcher);
		expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#c2483d');
	});

	it('updates --primary immediately when preset switches', () => {
		render(AccentWatcher);
		flushSync(() => vault.setAccent('accent-verdant'));
		expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#5c9e6e');
	});
});

describe('AccentWatcher — light mode', () => {
	beforeEach(() => setMode('light'));
	afterEach(() => resetMode());

	it('applies accent-crimson class on root with no inline --primary', () => {
		render(AccentWatcher);
		expect(document.documentElement.classList.contains('accent-crimson')).toBe(true);
		expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');
	});

	it('swaps class when preset switches', () => {
		render(AccentWatcher);
		flushSync(() => vault.setAccent('accent-arcane'));
		expect(document.documentElement.classList.contains('accent-arcane')).toBe(true);
		expect(document.documentElement.classList.contains('accent-crimson')).toBe(false);
		expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');
	});
});
