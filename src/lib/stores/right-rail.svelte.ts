import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
import { overlay } from './overlay.svelte.js';

export class RightRailState {
	#isMobile: IsMobile;
	open = $state(true);
	#openMobileInternal = $state(false);

	// Derived: false when another overlay panel is active (mutual exclusion)
	openMobile = $derived.by(() => this.#openMobileInternal && overlay.active === 'right-rail');

	constructor() {
		this.#isMobile = new IsMobile(1024);
	}

	get isMobile() {
		return this.#isMobile.current;
	}

	setOpenMobile = (value: boolean) => {
		this.#openMobileInternal = value;
		if (value) overlay.request('right-rail');
		else overlay.release('right-rail');
	};

	toggle = () => {
		if (this.#isMobile.current) {
			this.setOpenMobile(!this.#openMobileInternal);
		} else {
			this.open = !this.open;
		}
	};
}
