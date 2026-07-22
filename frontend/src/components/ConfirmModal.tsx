import { useState, type ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  // When set, the user must type this exact text to enable the confirm
  // button (type-to-confirm for destructive drops).
  confirmText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// Destructive-action confirmation (e.g. terminating a backend, dropping a table).
export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  busy = false,
  confirmText,
  onConfirm,
  onCancel,
}: Props) {
  const [typed, setTyped] = useState('');
  if (!open) return null;
  const locked = Boolean(confirmText) && typed !== confirmText;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle size={20} className="text-[color:var(--color-danger)]" />
          <h3 className="text-base font-semibold">{title}</h3>
        </div>
        <div className="text-sm text-muted">{body}</div>
        {confirmText && (
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={`Type "${confirmText}" to confirm`}
            className="mt-4 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 py-2 font-mono text-sm outline-none focus:border-[color:var(--color-danger)]"
          />
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-[color:var(--color-border)] px-4 py-2 text-sm hover:bg-[color:var(--color-surface-2)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || locked}
            className="flex items-center gap-2 rounded-lg bg-[color:var(--color-danger)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
