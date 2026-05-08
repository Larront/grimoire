export type OverlayPanel = 'sidebar' | 'right-rail';

class OverlayState {
	active = $state<OverlayPanel | null>(null);

	request(panel: OverlayPanel) {
		this.active = panel;
	}

	release(panel: OverlayPanel) {
		if (this.active === panel) this.active = null;
	}

}

export const overlay = new OverlayState();
