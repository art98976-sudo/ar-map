import { Compass, MoveUp } from 'lucide-react';
import { formatDistance } from '@/lib/route/constants';
import type { RouteStep } from '@/lib/types';
import { StepIcon } from '../../navigate/NavigatePanel';
import type { Hud } from '../engine/state';

/** Top offset of everything under the top bar. */
export const BELOW_TOP_BAR = 'top-[calc(max(0.75rem,env(safe-area-inset-top))+4.25rem)]';

/** The next instruction only, on one line. Always visible. */
export function ArTopBar({ hud, step }: { hud: Hud | null; step: RouteStep }) {
  // On the route with good tracking: an arrow pointing where to walk; otherwise the step's icon.
  const pointing = hud && hud.floorPrompt === null && !hud.status;
  return (
    <div
      data-ar-ui
      className="absolute inset-x-4 top-[max(0.75rem,env(safe-area-inset-top))] flex min-h-14 items-center gap-3 rounded-2xl bg-black/60 py-2 pr-4 pl-2 backdrop-blur"
      aria-live="polite"
    >
      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-[#0b7a85]" style={{ transform: `rotate(${pointing ? hud.arrowDeg : 0}deg)` }}>
        {pointing ? <MoveUp aria-hidden className="size-6" /> : <StepIcon step={step} className="size-6" />}
      </div>
      <p className="min-w-0 flex-1 truncate text-lg leading-tight font-semibold" data-testid="ar-instruction">
        {hud ? step.instruction : 'Starting AR…'}
      </p>
      {hud && !hud.arrived && hud.floorPrompt === null && hud.toNextStep > 1 && (
        <span className="shrink-0 text-lg font-semibold tabular-nums">{formatDistance(hud.toNextStep)}</span>
      )}
    </div>
  );
}

/** Why arrows are hidden right now (e.g. "Point your phone at the floor"). Gone as soon as it is fixed. */
export function ArStatus({ status, askMotion, onAskMotion }: { status: string; askMotion: boolean; onAskMotion(): void }) {
  return (
    <div data-ar-ui className={`absolute inset-x-4 ${BELOW_TOP_BAR} flex flex-col items-center gap-2`}>
      <p role="status" data-testid="ar-status" className="max-w-md rounded-xl bg-black/60 px-3 py-2 text-center text-sm font-medium backdrop-blur">
        {status}
      </p>
      {askMotion && (
        <button type="button" onClick={onAskMotion} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[#0b7a85] px-5 text-sm font-semibold shadow-lg">
          <Compass aria-hidden className="size-4" />
          Allow motion
        </button>
      )}
    </div>
  );
}
