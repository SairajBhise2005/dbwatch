import { Construction } from 'lucide-react';

// Rendered for pages that arrive in a later build stage.
export function Placeholder({ title, stage }: { title: string; stage: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-md rounded-2xl border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-10 text-center">
        <Construction size={32} className="mx-auto mb-4 text-[color:var(--color-warn)]" />
        <h2 className="mb-1 text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted">
          This page is built in <span className="font-medium">{stage}</span>.
          The navigation, layout, and live connection banner are already wired
          up in Stage 1.
        </p>
      </div>
    </div>
  );
}
