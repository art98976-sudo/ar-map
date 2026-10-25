import { Compass } from 'lucide-react';
import { APP_CONFIG } from '@/config/appConfig';
import { formatDistance } from '@/lib/route/constants';
import type { Route, RouteStep } from '@/lib/types';
import { StepIcon } from '../../navigate/NavigatePanel';
import type { Hud } from '../engine/state';

/** Top offset of everything under the top bar. */
export const BELOW_TOP_BAR = 'top-[calc(max(0.75rem,env(safe-area-inset-top))+4.25rem)]';

/** Under this distance the next step is shown as happening now, without "in 2 m". */
const NOW_M = 3;

/** What the top bar says: the next thing to do and how far away it is, e.g. "Turn left in 20 m". */
export function nextInstruction(route: Route, hud: Hud | null): { step: RouteStep; text: string } {
  const t = APP_CONFIG.text;
  const last = route.steps.at(-1)!;
  if (!hud) return { step: route.steps[0], text: 'Starting AR…' };
  if (hud.arrived) return { step: last, text: t.arrivedTitle(route.to.name) };
  // At a lift or stairs: the floor change itself, until it is confirmed.
  if (hud.floorPrompt !== null) {
    const step = route.steps[hud.floorPrompt];
    return { step, text: step.instruction };
  }
  const next = route.steps[hud.stepIndex + 1];
  if (!next) return { step: route.steps[hud.stepIndex], text: route.steps[hud.stepIndex].instruction };
  const distance = formatDistance(hud.toNextStep);
  if (next.type === 'arrive') return { step: next, text: t.arriveIn(distance) };
  if (hud.toNextStep < NOW_M) return { step: next, text: next.instruction };
  return { step: next, text: t.nextIn(next.instruction, distance) };
}

/** The next instruction only, with its direction icon. Always visible. */
export function ArTopBar({ hud, route }: { hud: Hud | null; route: Route }) {
  const { step, text } = nextInstruction(route, hud);
  return (
    <div
      data-ar-ui
      className="absolute inset-x-4 top-[max(0.75rem,env(safe-area-inset-top))] flex min-h-14 items-center gap-3 rounded-2xl bg-black/60 py-2 pr-4 pl-2 backdrop-blur"
      aria-live="polite"
    >
      <div className="grid size-11 shrink-0 place-items-center rounded-full bg-[#0b7a85]">
        <StepIcon step={step} className="size-6" />
      </div>
      <p className="line-clamp-2 min-w-0 flex-1 text-lg leading-tight font-semibold" data-testid="ar-instruction">
        {text}
      </p>
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
