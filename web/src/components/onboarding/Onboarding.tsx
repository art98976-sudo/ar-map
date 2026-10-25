'use client';

/**
 * The first-run tutorial: three short screens (search, switch to AR, follow the arrows).
 * Swipe left or right, tap a dot, or use Next; Skip is on every screen. All text is in APP_CONFIG.
 */
import { Box, ChevronsUp, Search, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { APP_CONFIG, type OnboardingIcon } from '@/config/appConfig';
import { cx } from '../ui/ui';

const ICONS: Record<OnboardingIcon, LucideIcon> = { search: Search, ar: Box, arrows: ChevronsUp };

export function Onboarding({ onClose }: { onClose(): void }) {
  const t = APP_CONFIG.text.onboarding;
  const slides = t.slides;
  const [index, setIndex] = useState(0);
  const last = index === slides.length - 1;
  const start = useRef<{ x: number; y: number } | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const go = (i: number) => setIndex(Math.max(0, Math.min(slides.length - 1, i)));
  const next = () => (last ? onClose() : go(index + 1));

  // Keyboard: arrows change screen, Escape skips. Focus starts on the main button.
  useEffect(() => {
    nextRef.current?.focus();
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(index + 1);
    else if (e.key === 'ArrowLeft') go(index - 1);
    else if (e.key === 'Escape') onClose();
  };

  // Swipe: a mostly sideways drag longer than the threshold changes screen.
  const onDown = (e: PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > APP_CONFIG.onboarding.swipePx && Math.abs(dx) > Math.abs(dy)) go(index + (dx < 0 ? 1 : -1));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.label}
      data-ar-ui
      onKeyDown={onKey}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={() => (start.current = null)}
      className="fixed inset-0 z-[60] flex touch-pan-y flex-col bg-gradient-to-br from-[#0b1f3a] to-[#0b7a85] pt-[env(safe-area-inset-top)] pb-[max(1rem,env(safe-area-inset-bottom))] text-white select-none"
    >
      <div className="flex justify-end px-3 pt-2">
        <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-full px-4 text-base font-semibold text-white/90 hover:bg-white/10">
          {t.skip}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{ width: `${slides.length * 100}%`, transform: `translateX(-${(index * 100) / slides.length}%)` }}
        >
          {slides.map((s, i) => {
            const Icon = ICONS[s.icon];
            return (
              <section
                key={s.title}
                aria-hidden={i !== index}
                inert={i !== index}
                aria-label={`${i + 1} of ${slides.length}`}
                className="flex h-full flex-col items-center justify-center px-8 text-center"
                style={{ width: `${100 / slides.length}%` }}
              >
                <div className="grid size-32 place-items-center rounded-full bg-white/15 ring-8 ring-white/5">
                  <Icon aria-hidden className="size-16" strokeWidth={1.75} />
                </div>
                <h2 className="mt-10 text-2xl font-semibold">{s.title}</h2>
                <p className="mt-3 max-w-xs text-base text-white/90">{s.body}</p>
                {i === slides.length - 1 && (
                  <p className="mt-8 inline-flex items-center gap-2 rounded-full bg-black/25 px-4 py-2 text-sm font-medium">
                    <TriangleAlert aria-hidden className="size-4 shrink-0 text-[#ffd166]" />
                    {t.safety}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </div>

      <div className="space-y-4 px-6">
        <div className="flex justify-center">
          {slides.map((s, i) => (
            <button
              key={s.title}
              type="button"
              onClick={() => go(i)}
              aria-label={t.goTo(i + 1)}
              aria-current={i === index ? 'step' : undefined}
              className="grid size-11 place-items-center"
            >
              <span className={cx('block h-2.5 rounded-full transition-all duration-300', i === index ? 'w-6 bg-white' : 'w-2.5 bg-white/40')} />
            </button>
          ))}
        </div>
        <button
          ref={nextRef}
          type="button"
          onClick={next}
          className="mx-auto block min-h-12 w-full max-w-sm rounded-full bg-white px-6 text-base font-semibold text-[#0b1f3a] shadow-lg"
        >
          {last ? t.getStarted : t.next}
        </button>
      </div>
    </div>
  );
}
