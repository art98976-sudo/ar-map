/**
 * The parts of the app state that live in the address bar, so a link can be shared
 * and opens the same view: ?tab=navigate&from=me&to=room:cottrell-1-101&acc=1
 */

export const TABS = ['explore', 'map', 'navigate', 'ar', 'saved'] as const;
export type Tab = (typeof TABS)[number];

export type FromValue = { kind: 'me' } | { kind: 'destination'; id: string };

export interface UrlState {
  tab: Tab;
  /** Destination shown in the card on the Map tab. */
  dest?: string;
  from: FromValue;
  to?: string;
  accessible: boolean;
  /** Highlighted route step. */
  step?: number;
}

export const DEFAULT_STATE: UrlState = { tab: 'map', from: { kind: 'me' }, accessible: false };

/** Ids are short and simple ("room:cottrell-1-101"); anything else in a link is ignored. */
const VALID_ID = /^[a-z]+:[a-z0-9-]{1,80}$/;
const validId = (v: string | null) => (v && VALID_ID.test(v) ? v : undefined);

export function parseUrlState(search: string): UrlState {
  const q = new URLSearchParams(search);
  const tabParam = q.get('tab');
  const tab = (TABS as readonly string[]).includes(tabParam ?? '') ? (tabParam as Tab) : DEFAULT_STATE.tab;
  const fromId = validId(q.get('from'));
  const stepParam = Number(q.get('step'));
  return {
    tab,
    dest: validId(q.get('dest')),
    from: fromId ? { kind: 'destination', id: fromId } : { kind: 'me' },
    to: validId(q.get('to')),
    accessible: q.get('acc') === '1',
    ...(Number.isInteger(stepParam) && stepParam > 0 ? { step: stepParam } : {}),
  };
}

export function serializeUrlState(s: UrlState): string {
  const q = new URLSearchParams();
  if (s.tab !== DEFAULT_STATE.tab) q.set('tab', s.tab);
  if (s.dest && s.tab === 'map') q.set('dest', s.dest);
  if (s.tab === 'navigate' || s.tab === 'ar') {
    if (s.from.kind === 'destination') q.set('from', s.from.id);
    if (s.to) q.set('to', s.to);
    if (s.accessible) q.set('acc', '1');
    if (s.step) q.set('step', String(s.step));
  }
  const str = q.toString();
  return str ? `?${str}` : '';
}

/** A link that opens the Navigate tab with this route. "My location" stays as the viewer's own location. */
export function routeShareUrl(origin: string, s: Pick<UrlState, 'from' | 'to' | 'accessible'>): string {
  return `${origin}/${serializeUrlState({ tab: 'navigate', from: s.from, to: s.to, accessible: s.accessible })}`;
}
