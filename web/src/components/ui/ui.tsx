'use client';

import { CircleAlert, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

type Variant = 'primary' | 'secondary' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-teal text-on-accent hover:bg-teal-strong shadow-sm',
  secondary: 'border border-border bg-surface text-foreground hover:bg-surface-muted',
  ghost: 'text-foreground hover:bg-surface-muted',
};

export function Button({
  variant = 'primary',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'inline-grid size-11 shrink-0 place-items-center rounded-full text-foreground transition-colors hover:bg-surface-muted',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  icon,
}: {
  checked: boolean;
  onChange(next: boolean): void;
  label: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-1 text-left focus-visible:outline-2 focus-visible:outline-teal"
    >
      {icon}
      <span className="flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
      <span
        aria-hidden
        className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-teal' : 'bg-border')}
      >
        <span
          className={cx(
            'absolute top-1 size-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </span>
    </button>
  );
}

const TONES = {
  info: { icon: Info, cls: 'border-teal/40 bg-teal/10' },
  warning: { icon: TriangleAlert, cls: 'border-amber-500/50 bg-amber-500/10' },
  error: { icon: CircleAlert, cls: 'border-red-500/50 bg-red-500/10' },
} as const;

export function Notice({ tone = 'info', children, action }: { tone?: keyof typeof TONES; children: ReactNode; action?: ReactNode }) {
  const { icon: Icon, cls } = TONES[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex gap-3 rounded-xl border p-3 text-sm', cls)}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1 space-y-2">
        <div>{children}</div>
        {action}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <LoaderCircle aria-hidden className="size-4 animate-spin" />
      {label}
    </span>
  );
}

export function Toast({ message }: { message: string | null }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 lg:bottom-6">
      {message && (
        <p className="rounded-full bg-navy px-4 py-2.5 text-sm font-medium text-background shadow-lg">{message}</p>
      )}
    </div>
  );
}
