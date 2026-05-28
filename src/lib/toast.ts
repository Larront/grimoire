import { toast } from "svelte-sonner";

export function toastError(message: string) {
  toast.error(message, { duration: Infinity });
}

export function toastSuccess(message: string) {
  toast.success(message, { duration: 3000 });
}

export function toastImportFailures(
  failures: { path: string; reason: string }[],
  onShowDetails: () => void,
) {
  if (failures.length === 0) return;
  const n = failures.length;
  toast(`Couldn't import ${n} file${n === 1 ? "" : "s"}`, {
    action: {
      label: "Show details",
      onClick: onShowDetails,
    },
  });
}

/** Show an undo toast. `onConfirm` is called after the toast duration if the user does not click Undo. */
export function toastUndo(
  message: string,
  onConfirm: () => void,
  duration = 5000,
) {
  const timerId = setTimeout(onConfirm, duration);

  toast(message, {
    duration,
    action: {
      label: "Undo",
      onClick: () => clearTimeout(timerId),
    },
  });
}
