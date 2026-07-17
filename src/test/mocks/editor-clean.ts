// Shared, test-controllable state for the mocked Editor. `editorClean.value`
// backs the mock's isClean() so a test can drive NotePane's clean-reload vs
// conflict-banner branches deterministically without a real TipTap instance.
// `editorCalls` records the autosave-control calls NotePane makes during
// conflict resolution (issue #129), so tests can assert the wiring that stops
// a queued autosave from clobbering the external edit.
export const editorClean = { value: true };
export const editorCalls = { pause: 0, resume: 0, discard: 0 };
