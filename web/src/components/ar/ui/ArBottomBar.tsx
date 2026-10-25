import { Map as MapIcon, Menu } from 'lucide-react';
import { formatDistance, formatDuration, WALKING_SPEED_MPS } from '@/lib/route/constants';
import { cx } from '../../ui/ui';

interface ArBottomBarProps {
  destName: string;
  /** Metres left, or null before AR has started. */
  remaining: number | null;
  /** Faded after a while without a touch. */
  faded: boolean;
  menuOpen: boolean;
  onMenu(): void;
  onEnd(): void;
  onShowMap?: () => void;
}

/** Destination, distance and time left ("Library / 120 m · 2 min"), the 2D map button, the ☰ menu button and End. */
export function ArBottomBar({ destName, remaining, faded, menuOpen, onMenu, onEnd, onShowMap }: ArBottomBarProps) {
  return (
    <div
      data-ar-ui
      className={cx('flex min-h-14 items-center gap-2 rounded-2xl bg-black/60 p-1.5 backdrop-blur transition-opacity duration-500', faded && 'opacity-30')}
    >
      {onShowMap && (
        <button type="button" onClick={onShowMap} aria-label="Show 2D map" className="grid size-11 shrink-0 place-items-center rounded-full bg-white/15">
          <MapIcon aria-hidden className="size-5" />
        </button>
      )}
      <div className={cx('min-w-0 flex-1 leading-tight', !onShowMap && 'pl-2')} data-testid="ar-summary">
        {/* Two short lines in the same compact bar: on a 360 px phone one line would cut the name to a few letters. */}
        <p className="truncate text-sm font-semibold">{destName}</p>
        <p className="text-sm text-white/85 tabular-nums">{remaining === null ? '…' : `${formatDistance(remaining)} · ${formatDuration(remaining / WALKING_SPEED_MPS)}`}</p>
      </div>
      <button
        type="button"
        onClick={onMenu}
        aria-label="AR menu"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className={cx('grid size-11 shrink-0 place-items-center rounded-full', menuOpen ? 'bg-white text-[#0b1f3a]' : 'bg-white/15')}
      >
        <Menu aria-hidden className="size-5" />
      </button>
      <button type="button" onClick={onEnd} className="min-h-11 shrink-0 rounded-full bg-white px-4 text-sm font-semibold text-[#0b1f3a]">
        End
      </button>
    </div>
  );
}
