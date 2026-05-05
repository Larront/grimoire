import '@testing-library/jest-dom';
import { vi } from 'vitest';

// mode-watcher calls localStorage.getItem at module init
const localStorageMock = {
	getItem: vi.fn().mockReturnValue(null),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn(),
	length: 0,
	key: vi.fn().mockReturnValue(null),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });

// mode-watcher reads matchMedia to detect prefers-color-scheme
Object.defineProperty(window, 'matchMedia', {
	writable: true,
	value: vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
});

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
	open: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
	readTextFile: vi.fn().mockResolvedValue(''),
	writeTextFile: vi.fn().mockResolvedValue(undefined),
	exists: vi.fn().mockResolvedValue(false),
	watch: vi.fn().mockResolvedValue(() => {}),
	watchImmediate: vi.fn().mockResolvedValue(() => {}),
}));
