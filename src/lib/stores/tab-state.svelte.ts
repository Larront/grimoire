class TabState {
	lastNoteId = $state<number | null>(null);
}

export const tabState = new TabState();
