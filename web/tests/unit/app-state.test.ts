import { beforeEach, describe, expect, it } from 'vitest';
import { SAVED_KEY, savedStore } from '@/lib/state/saved';
import { DEFAULT_STATE, parseUrlState, routeShareUrl, serializeUrlState } from '@/lib/state/urlState';

describe('share links', () => {
  it('round-trips a navigation link', () => {
    const state = parseUrlState('?tab=navigate&from=building:library&to=room:cottrell-1-101&acc=1&step=3');
    expect(state).toEqual({
      tab: 'navigate',
      dest: undefined,
      from: { kind: 'destination', id: 'building:library' },
      to: 'room:cottrell-1-101',
      accessible: true,
      step: 3,
    });
    expect(parseUrlState(serializeUrlState(state))).toEqual(state);
  });

  it('defaults to the map with "My location" as the start', () => {
    expect(parseUrlState('')).toEqual({ ...DEFAULT_STATE, dest: undefined, to: undefined });
    expect(serializeUrlState(DEFAULT_STATE)).toBe('');
  });

  it('ignores unknown tabs and malformed ids', () => {
    const s = parseUrlState('?tab=admin&to=<script>&from=javascript:alert(1)&step=-2');
    expect(s.tab).toBe('map');
    expect(s.to).toBeUndefined();
    expect(s.from).toEqual({ kind: 'me' });
    expect(s.step).toBeUndefined();
  });

  it('builds a route link that keeps "My location" for the person opening it', () => {
    const url = routeShareUrl('https://example.org', { from: { kind: 'me' }, to: 'place:library-cafe', accessible: true });
    expect(url).toBe('https://example.org/?tab=navigate&to=place%3Alibrary-cafe&acc=1');
  });

  it('only keeps the selected place on the map tab', () => {
    expect(serializeUrlState({ ...DEFAULT_STATE, dest: 'building:library' })).toBe('?dest=building%3Alibrary');
    expect(serializeUrlState({ ...DEFAULT_STATE, tab: 'saved', dest: 'building:library' })).toBe('?tab=saved');
  });
});

describe('saved places', () => {
  const memory = new Map<string, string>();
  beforeEach(() => {
    memory.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => memory.get(k) ?? null,
        setItem: (k: string, v: string) => void memory.set(k, v),
      },
    });
    savedStore.reset();
  });

  it('saves and unsaves a place', () => {
    expect(savedStore.toggle('building:library')).toBe(true);
    expect(savedStore.getSnapshot()).toContain('building:library');
    expect(JSON.parse(memory.get(SAVED_KEY)!)).toEqual(['building:library']);
    expect(savedStore.toggle('building:library')).toBe(false);
    expect(savedStore.getSnapshot()).toEqual([]);
  });

  it('puts the newest first and notifies listeners', () => {
    let calls = 0;
    const unsubscribe = savedStore.subscribe(() => calls++);
    savedStore.toggle('a:1');
    savedStore.toggle('b:2');
    expect(savedStore.getSnapshot()).toEqual(['b:2', 'a:1']);
    expect(calls).toBe(2);
    unsubscribe();
  });

  it('survives broken or blocked storage', () => {
    memory.set(SAVED_KEY, '{not json');
    expect(savedStore.getSnapshot()).toEqual([]);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    savedStore.reset();
    expect(savedStore.getSnapshot()).toEqual([]);
    expect(savedStore.toggle('building:library')).toBe(true);
  });
});
