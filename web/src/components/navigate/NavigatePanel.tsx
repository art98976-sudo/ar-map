'use client';

import {
  Accessibility,
  ArrowUp,
  ArrowUpDown,
  ArrowUpLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  LocateFixed,
  LogIn,
  LogOut,
  MapPin,
  MoveDown,
  MoveUp,
  Share2,
  Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatDistance, formatDuration } from '@/lib/route/constants';
import type { FromValue } from '@/lib/state/urlState';
import type { Destination, Route, RouteStep } from '@/lib/types';
import { Button, IconButton, Notice, Spinner, Switch, cx } from '../ui/ui';

export type RouteState =
  | { status: 'idle' }
  | { status: 'loading'; message: string }
  | { status: 'ok'; route: Route }
  | { status: 'error'; message: string; chooseStart?: boolean };

type StepIconName = 'enter' | 'exit' | 'arrive' | 'up' | 'down' | 'left' | 'slight-left' | 'right' | 'slight-right' | 'u-turn' | 'ahead';

function stepIconName(s: RouteStep): StepIconName {
  switch (s.type) {
    case 'enter-building':
      return 'enter';
    case 'exit-building':
      return 'exit';
    case 'arrive':
      return 'arrive';
    case 'change-floor':
      return (s.floorChange?.toLevel ?? 0) > (s.floorChange?.fromLevel ?? 0) ? 'up' : 'down';
    case 'turn':
      if (s.turn === 'u-turn') return 'u-turn';
      if (s.turn === 'straight' || !s.turn) return 'ahead';
      return s.turn.replace('sharp-', '') as StepIconName;
    default:
      return 'ahead';
  }
}

/** Icon for a step, as fixed components so React keeps them stable between renders. */
export function StepIcon({ step, className }: { step: RouteStep; className?: string }) {
  const p = { 'aria-hidden': true, className };
  switch (stepIconName(step)) {
    case 'enter': return <LogIn {...p} />;
    case 'exit': return <LogOut {...p} />;
    case 'arrive': return <Flag {...p} />;
    case 'up': return <MoveUp {...p} />;
    case 'down': return <MoveDown {...p} />;
    case 'left': return <CornerUpLeft {...p} />;
    case 'slight-left': return <ArrowUpLeft {...p} />;
    case 'right': return <CornerUpRight {...p} />;
    case 'slight-right': return <ArrowUpRight {...p} />;
    case 'u-turn': return <Undo2 {...p} />;
    default: return <ArrowUp {...p} />;
  }
}

function Field({ label, value, icon, onClick, testId }: { label: string; value: string; icon: React.ReactNode; onClick(): void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-teal"
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold tracking-wide text-muted uppercase">{label}</span>
        <span className={cx('block truncate text-sm font-medium', value === 'Choose destination' && 'text-muted')}>{value}</span>
      </span>
    </button>
  );
}

export function RouteForm({
  from,
  fromDest,
  toDest,
  accessible,
  onAccessible,
  onPickFrom,
  onPickTo,
  onSwap,
}: {
  from: FromValue;
  fromDest: Destination | null;
  toDest: Destination | null;
  accessible: boolean;
  onAccessible(v: boolean): void;
  onPickFrom(): void;
  onPickTo(): void;
  onSwap(): void;
}) {
  return (
    <section aria-label="Route" className="space-y-2 rounded-2xl border border-border bg-surface p-3 shadow-lg">
      <div className="flex items-center gap-2">
        <div className="flex-1 space-y-2">
          <Field
            testId="route-from"
            label="From"
            value={from.kind === 'me' ? 'My location' : fromDest?.name ?? 'Choose a starting point'}
            icon={from.kind === 'me' ? <LocateFixed aria-hidden className="size-5 text-teal" /> : <span aria-hidden className="ml-1 size-3 rounded-full border-[3px] border-teal" />}
            onClick={onPickFrom}
          />
          <Field
            testId="route-to"
            label="To"
            value={toDest?.name ?? 'Choose destination'}
            icon={<MapPin aria-hidden className="size-5 text-teal" />}
            onClick={onPickTo}
          />
        </div>
        <IconButton label="Swap start and destination" onClick={onSwap} disabled={!toDest}>
          <ArrowUpDown aria-hidden className="size-5" />
        </IconButton>
      </div>
      <Switch
        checked={accessible}
        onChange={onAccessible}
        label="Step-free route"
        description="Avoids stairs and steps; uses ramps and lifts"
        icon={<Accessibility aria-hidden className="size-5 text-teal" />}
      />
    </section>
  );
}

export function RouteSheet({
  state,
  activeStep,
  onStep,
  onShare,
  onRetry,
  onChooseStart,
  onShowFloor,
}: {
  state: RouteState;
  activeStep: number;
  onStep(i: number): void;
  onShare(): void;
  onRetry(): void;
  onChooseStart(): void;
  /** Switch the map to the floor a floor-change step leads to. */
  onShowFloor(step: RouteStep): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeStep, expanded]);

  if (state.status === 'idle') return null;
  if (state.status === 'loading') {
    return <div className="rounded-2xl border border-border bg-surface p-4 shadow-lg"><Spinner label={state.message} /></div>;
  }
  if (state.status === 'error') {
    return (
      <Notice
        tone={state.chooseStart ? 'warning' : 'error'}
        action={
          <div className="flex flex-wrap gap-2">
            {state.chooseStart && <Button onClick={onChooseStart}>Choose a starting point</Button>}
            <Button variant="secondary" onClick={onRetry}>Try again</Button>
          </div>
        }
      >
        {state.message}
      </Notice>
    );
  }

  const r = state.route;
  const step = r.steps[activeStep] ?? r.steps[0];
  const floors = new Set(r.steps.flatMap((s) => s.path.map((p) => p.level)).filter((l) => l !== undefined));

  return (
    <section aria-label="Directions" className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xl">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex-1">
          <p className="flex items-baseline gap-2">
            <span className="text-2xl font-bold" data-testid="route-duration">{formatDuration(r.durationSeconds)}</span>
            <span className="text-sm text-muted">{formatDistance(r.distanceMetres)}{r.accessible ? ' · step-free' : ''}</span>
          </p>
          <p className="text-xs text-muted">
            <Clock aria-hidden className="mr-1 inline size-3" />
            Walking{floors.size > 1 ? ` · ${floors.size} floors` : ''} · {r.isSampleData ? 'approximate sample route' : 'University campus map route'}
          </p>
        </div>
        <IconButton label="Share route" onClick={onShare}>
          <Share2 aria-hidden className="size-5" />
        </IconButton>
        <IconButton label={expanded ? 'Hide all steps' : 'Show all steps'} onClick={() => setExpanded((v) => !v)} className="lg:hidden" aria-expanded={expanded}>
          {expanded ? <ChevronDown aria-hidden className="size-5" /> : <ChevronUp aria-hidden className="size-5" />}
        </IconButton>
      </div>

      {r.warnings?.map((w) => (
        <div key={w} className="px-4 pt-3"><Notice tone="warning">{w}</Notice></div>
      ))}

      {step.type === 'change-floor' && step.floorChange?.toFloorName && (
        <div className="px-4 pt-3">
          <Button variant="secondary" className="w-full" onClick={() => onShowFloor(step)}>
            {step.floorChange.toLevel > step.floorChange.fromLevel ? <MoveUp aria-hidden className="size-4" /> : <MoveDown aria-hidden className="size-4" />}
            Show {step.floorChange.toFloorName} on the map
          </Button>
        </div>
      )}

      {/* Current step with previous / next */}
      <div className={cx('flex items-center gap-2 px-2 py-2', expanded && 'max-lg:hidden', 'lg:hidden')}>
        <IconButton label="Previous step" onClick={() => onStep(activeStep - 1)} disabled={activeStep === 0}>
          <ChevronLeft aria-hidden className="size-6" />
        </IconButton>
        <div className="flex min-w-0 flex-1 items-center gap-3" aria-live="polite">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-teal text-on-accent"><StepIcon step={step} className="size-5" /></span>
          <div className="min-w-0">
            <p className="text-sm leading-snug font-semibold" data-testid="current-step">{step.instruction}</p>
            <p className="text-xs text-muted">
              Step {activeStep + 1} of {r.steps.length}
              {step.distanceMetres > 0 && ` · ${formatDistance(step.distanceMetres)}`}
            </p>
          </div>
        </div>
        <IconButton label="Next step" onClick={() => onStep(activeStep + 1)} disabled={activeStep >= r.steps.length - 1}>
          <ChevronRight aria-hidden className="size-6" />
        </IconButton>
      </div>

      <ol aria-label="Steps" className={cx('max-h-[40dvh] overflow-y-auto lg:max-h-none', !expanded && 'max-lg:hidden')}>
        {r.steps.map((s) => {
          const active = s.index === activeStep;
          return (
            <li key={s.index} ref={active ? activeRef : undefined}>
              <button
                type="button"
                aria-current={active ? 'step' : undefined}
                onClick={() => onStep(s.index)}
                className={cx(
                  'flex min-h-14 w-full items-start gap-3 border-l-4 px-4 py-3 text-left',
                  active ? 'border-teal bg-teal/10' : 'border-transparent hover:bg-surface-muted',
                )}
              >
                <StepIcon step={s} className={cx('mt-0.5 size-5 shrink-0', active ? 'text-teal' : 'text-muted')} />
                <span className="flex-1">
                  <span className="block text-sm font-medium">{s.instruction}</span>
                  {(s.distanceMetres > 0 || s.type === 'change-floor') && (
                    <span className="block text-xs text-muted">
                      {s.type === 'change-floor' ? formatDuration(s.durationSeconds) : `${formatDistance(s.distanceMetres)} · ${formatDuration(s.durationSeconds)}`}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
