'use client';

import { Bookmark, Box, Compass, Map, Navigation, type LucideIcon } from 'lucide-react';
import type { Tab } from '@/lib/state/urlState';
import { cx } from '../ui/ui';

const ITEMS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'explore', label: 'Explore', icon: Compass },
  { id: 'map', label: 'Map', icon: Map },
  { id: 'navigate', label: 'Navigate', icon: Navigation },
  { id: 'ar', label: 'AR', icon: Box },
  { id: 'saved', label: 'Saved', icon: Bookmark },
];

export function TabBar({ tab, onTab, variant }: { tab: Tab; onTab(t: Tab): void; variant: 'bottom' | 'top' }) {
  return (
    <nav
      aria-label="Main"
      className={cx(
        variant === 'bottom'
          ? 'fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden'
          : 'hidden border-b border-border lg:block',
      )}
    >
      <ul className="mx-auto flex max-w-lg">
        {ITEMS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <li key={id} className="flex-1">
              <button
                type="button"
                onClick={() => onTab(id)}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex h-16 w-full flex-col items-center justify-center gap-1 text-xs font-medium transition-colors',
                  'focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-teal',
                  active ? 'text-teal' : 'text-muted hover:text-foreground',
                )}
              >
                <span className={cx('grid h-7 w-12 place-items-center rounded-full transition-colors', active && 'bg-teal/15')}>
                  <Icon aria-hidden className="size-5" />
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
