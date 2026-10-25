import { X } from 'lucide-react';
import { cx } from '../ui/ui';

interface FloorControlProps {
  buildingName: string;
  floors: { id: string; level: number; name: string }[];
  level: number;
  onLevel(l: number): void;
  /** Omitted when floors cannot be turned off (MazeMap's map). */
  onClose?(): void;
}

/** The floor switcher shown beside the map. */
export function FloorControl({ buildingName, floors, level, onLevel, onClose }: FloorControlProps) {
  return (
    <div role="group" aria-label={`${buildingName} floors`} className="w-24 overflow-hidden rounded-2xl border border-border bg-surface shadow-lg">
      <div className="flex items-center justify-between pl-2">
        <span className="truncate text-xs font-semibold">{buildingName}</span>
        {onClose ? (
          <button type="button" aria-label="Close indoor map" onClick={onClose} className="grid size-9 place-items-center text-muted hover:text-foreground">
            <X aria-hidden className="size-4" />
          </button>
        ) : (
          <span className="h-9" />
        )}
      </div>
      {/* Many floors (MazeMap campus): scroll instead of covering the panels. */}
      <div className="max-h-[8.25rem] overflow-y-auto lg:max-h-[22rem]">
        {[...floors].reverse().map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={f.level === level}
            onClick={() => onLevel(f.level)}
            className={cx('block min-h-11 w-full border-t border-border px-2 text-sm font-medium', f.level === level ? 'bg-teal text-on-accent' : 'hover:bg-surface-muted')}
          >
            {f.name}
          </button>
        ))}
      </div>
    </div>
  );
}
