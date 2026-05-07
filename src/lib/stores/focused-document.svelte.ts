class FocusedDocumentState {
	name = $state<string | null>(null);
	path = $state<string | null>(null);

	set(name: string, path: string) {
		this.name = name;
		this.path = path;
	}

	clear() {
		this.name = null;
		this.path = null;
	}
}

export const focusedDocument = new FocusedDocumentState();
