/** Cards shown only at particular moments: starting AR, calibrating, changing floor, arriving, debugging. */
import { Footprints, MapPin } from 'lucide-react';
import { APP_CONFIG } from '@/config/appConfig';
import type { RouteStep } from '@/lib/types';
import { BELOW_TOP_BAR } from './ArTopBar';

/** Ground tracking is available: start it from a tap (browsers require one). */
export function StartArCard({ onStart, onSimple }: { onStart(): void; onSimple(): void }) {
  return (
    <div data-ar-ui className="rounded-2xl bg-black/75 p-4 text-center backdrop-blur">
      <p className="font-semibold">Start AR</p>
      <p className="mt-1 text-sm text-white/85">Arrows will lie on the real ground. Point the camera at the floor after starting.</p>
      <button type="button" onClick={onStart} className="mt-3 min-h-12 w-full rounded-full bg-[#0b7a85] px-5 font-semibold">
        Start AR
      </button>
      <button type="button" onClick={onSimple} className="mt-1 min-h-11 w-full rounded-full px-5 text-sm font-semibold text-white/85">
        Use the simple camera view instead
      </button>
    </div>
  );
}

/** Ground calibration (camera overlay): the next tap on the ground measures the phone's height. */
export function CalibrationCard({ onCancel }: { onCancel(): void }) {
  return (
    <div data-ar-ui className={`absolute inset-x-4 ${BELOW_TOP_BAR} rounded-2xl bg-black/70 p-4 text-center backdrop-blur`}>
      <Footprints aria-hidden className="mx-auto size-6" />
      <p className="mt-1 font-semibold">Tap the ground about 3 steps (2 m) ahead</p>
      <p className="mt-1 text-sm text-white/80">Hold the phone as you will while walking.</p>
      <button type="button" onClick={onCancel} className="mt-3 min-h-11 rounded-full bg-white/15 px-5 text-sm font-semibold">
        Cancel
      </button>
    </div>
  );
}

/** At a lift or stairs: confirm the new floor before arrows continue. */
export function FloorPrompt({ step, onConfirm }: { step: RouteStep; onConfirm(): void }) {
  return (
    <button type="button" data-ar-ui onClick={onConfirm} className="w-full rounded-2xl bg-[#0b7a85] px-4 py-3 text-left font-semibold shadow-lg">
      {step.instruction}
      <span className="block text-sm font-normal text-white/85">Tap when you are on {step.floorChange?.toFloorName ?? 'the new floor'}</span>
    </button>
  );
}

/** Arriving: the destination from the route, and what to do next. Sits at the bottom, so the pin stays in view. */
export function ArrivedCard({ destName, onDone, onNavigateElsewhere }: { destName: string; onDone(): void; onNavigateElsewhere?: () => void }) {
  const t = APP_CONFIG.text;
  return (
    <div data-ar-ui className="animate-[ar-card-in_300ms_ease-out] rounded-2xl bg-black/75 p-4 text-center backdrop-blur" role="status">
      <MapPin aria-hidden className="mx-auto size-7 text-[#68d391]" />
      <p className="mt-1 text-lg font-semibold" data-testid="ar-arrived">
        {t.arrivedTitle(destName)}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {onNavigateElsewhere && (
          <button type="button" onClick={onNavigateElsewhere} className="min-h-11 rounded-full bg-[#0b7a85] px-5 font-semibold">
            {t.navigateElsewhere}
          </button>
        )}
        <button type="button" onClick={onDone} className="min-h-11 rounded-full bg-white px-6 font-semibold text-[#0b1f3a]">
          {t.done}
        </button>
      </div>
    </div>
  );
}

/** Debug text (off by default). Read-only: taps pass through, e.g. for ground calibration. */
export function DebugPanel({ lines }: { lines: string[] }) {
  return (
    <pre
      data-testid="ar-debug"
      className="pointer-events-none absolute inset-x-4 top-[calc(max(0.75rem,env(safe-area-inset-top))+8.5rem)] max-h-[30vh] overflow-hidden rounded-lg bg-black/70 p-2 font-mono text-[10px] leading-tight whitespace-pre-wrap text-lime-300"
    >
      {lines.join('\n')}
      {'\n'}legend: magenta = raw route, cyan = arrow anchors, red dashes = horizon (camera mode)
    </pre>
  );
}
