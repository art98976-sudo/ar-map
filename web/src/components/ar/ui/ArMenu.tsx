/** Everything not needed while walking, behind the ☰ button. */
import { Bug, ChevronLeft, ChevronRight, CircleHelp, Compass, Footprints, LocateFixed, Pause, Play, ScanLine, Video, VideoOff } from 'lucide-react';
import { APP_CONFIG } from '@/config/appConfig';
import { cx } from '../../ui/ui';

const row = 'flex min-h-11 items-center gap-2 rounded-xl px-3 text-left font-medium hover:bg-white/10 active:bg-white/15';
const item = `${row} w-full`;
const iconButton = 'grid size-11 place-items-center rounded-xl hover:bg-white/10 disabled:opacity-30';

interface ArMenuProps {
  /** Status chips. */
  gpsText: string;
  compassText: string;
  engineText: string;
  engineIcon: 'xr' | 'camera' | 'none';
  /** Step navigation (null before AR has started). */
  step: { index: number; count: number } | null;
  onStep(index: number): void;
  onAlign(): void;
  /** Camera overlay only. */
  onCalibrate?: () => void;
  /** Shown when ground tracking is available but not in use. */
  onGroundTracking?: () => void;
  /** Camera overlay only: the simulated walk. */
  simulation?: { on: boolean; speed: number; onToggle(): void; onSpeed(): void };
  debug: boolean;
  onDebug(): void;
  /** Shows the first-run tutorial again. */
  onTutorial(): void;
  /** Closes the menu (called before each action that changes mode). */
  onClose(): void;
}

export function ArMenu(p: ArMenuProps) {
  const act = (fn: () => void) => () => {
    p.onClose();
    fn();
  };
  const EngineIcon = p.engineIcon === 'xr' ? ScanLine : p.engineIcon === 'camera' ? Video : VideoOff;
  return (
    <div data-ar-ui role="menu" aria-label="AR options" className="w-[min(20rem,100%)] space-y-1 self-end rounded-2xl bg-black/80 p-2 text-sm backdrop-blur">
      <div className="flex flex-wrap gap-1.5 px-1 pb-1 text-xs text-white/85">
        <span className="rounded-full bg-white/10 px-2.5 py-1" data-testid="ar-gps">
          <LocateFixed aria-hidden className="mr-1 inline size-3.5" />
          {p.gpsText}
        </span>
        <span className="rounded-full bg-white/10 px-2.5 py-1">
          <Compass aria-hidden className="mr-1 inline size-3.5" />
          {p.compassText}
        </span>
        <span className="rounded-full bg-white/10 px-2.5 py-1" data-testid="ar-engine">
          <EngineIcon aria-hidden className="mr-1 inline size-3.5" />
          {p.engineText}
        </span>
      </div>
      {p.step && (
        <div className="flex items-center gap-1">
          <button type="button" role="menuitem" aria-label="Previous step" onClick={() => p.onStep(p.step!.index - 1)} disabled={p.step.index === 0} className={iconButton}>
            <ChevronLeft aria-hidden className="size-5" />
          </button>
          <span className="flex-1 text-center text-white/85">
            Step {p.step.index + 1} of {p.step.count}
          </span>
          <button
            type="button"
            role="menuitem"
            aria-label="Next step"
            onClick={() => p.onStep(p.step!.index + 1)}
            disabled={p.step.index >= p.step.count - 1}
            className={iconButton}
          >
            <ChevronRight aria-hidden className="size-5" />
          </button>
        </div>
      )}
      <button type="button" role="menuitem" onClick={act(p.onAlign)} className={item} title="Point the phone along the path you are on, then tap">
        <Compass aria-hidden className="size-4" />
        Align with the path
      </button>
      {p.onCalibrate && (
        <button type="button" role="menuitem" onClick={act(p.onCalibrate)} className={item}>
          <Footprints aria-hidden className="size-4" />
          Calibrate ground
        </button>
      )}
      {p.onGroundTracking && (
        <button type="button" role="menuitem" onClick={act(p.onGroundTracking)} className={item}>
          <ScanLine aria-hidden className="size-4" />
          Use ground tracking
        </button>
      )}
      {p.simulation && (
        <div className="flex gap-1">
          <button type="button" role="menuitemcheckbox" aria-checked={p.simulation.on} onClick={act(p.simulation.onToggle)} className={cx(row, 'flex-1 whitespace-nowrap')}>
            {p.simulation.on ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
            {p.simulation.on ? 'Pause walk' : 'Simulate walk'}
          </button>
          {p.simulation.on && (
            <button type="button" role="menuitem" onClick={p.simulation.onSpeed} className={cx(row, 'w-14 shrink-0 justify-center tabular-nums')} aria-label="Simulation speed">
              {p.simulation.speed}×
            </button>
          )}
        </div>
      )}
      <button type="button" role="menuitem" onClick={act(p.onTutorial)} className={item}>
        <CircleHelp aria-hidden className="size-4" />
        {APP_CONFIG.text.showTutorial}
      </button>
      <button type="button" role="menuitemcheckbox" aria-checked={p.debug} aria-label="Debug overlay" onClick={act(p.onDebug)} className={item}>
        <Bug aria-hidden className={cx('size-4', p.debug && 'text-fuchsia-400')} />
        Debug info {p.debug ? 'on' : 'off'}
      </button>
    </div>
  );
}
