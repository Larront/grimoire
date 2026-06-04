// The Command Wrapper (see CONTEXT.md). The single boundary over the generated
// Command Bindings. Frontend code imports commands from here — never from
// `$lib/bindings.gen` directly (ADR-0009).
//
// Throw mode (ADR-0009): each command returns `Promise<T>` and rejects with the
// Rust `Err` payload. Callers that already own their error handling (the entity
// stores, the Details Source modules) use these typed commands directly. A
// toast-on-throw posture and the raw-bytes command carve-outs will be layered
// here as the migration proceeds; doing so changes nothing at the call sites.
export { commands as api } from "$lib/bindings.gen";
