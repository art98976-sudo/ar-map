import type { Destination, SearchFilters } from '../../types';

const DEFAULT_LIMIT = 20;

/** Lowercase, strip accents and punctuation so "students union" finds "Students' Union". */
export function normaliseText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
}

/** Lower is better. Returns null when the destination does not match. */
function score(dest: Destination, q: string): number | null {
  const name = normaliseText(dest.name);
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.split(' ').some((w) => w.startsWith(q))) return 2;
  if (name.includes(q)) return 3;
  const extra = [...(dest.aliases ?? []), dest.buildingName ?? '', dest.kind.replace('-', ' ')].map(normaliseText);
  if (extra.some((t) => t.startsWith(q) || t.split(' ').some((w) => w.startsWith(q)))) return 4;
  // Every query word appears somewhere: "cottrell cafe", "seminar 1.01"
  const haystack = [name, ...extra].join(' ');
  const words = q.split(' ');
  if (words.length > 1 && words.every((w) => haystack.includes(w))) return 5;
  return null;
}

const buildingFirst = (d: Destination) => (d.kind === 'building' ? 0 : 1);

/** Simple ranked text search. An empty query lists everything (used by Explore). */
export function searchDestinationList(all: Destination[], query: string, filters: SearchFilters = {}): Destination[] {
  const q = normaliseText(query);
  const cats = filters.categories ?? [];
  const pool = cats.length ? all.filter((d) => d.categories.some((c) => cats.includes(c))) : all;

  return pool
    .map((d) => ({ d, s: q ? score(d, q) : 0 }))
    .filter((r): r is { d: Destination; s: number } => r.s !== null)
    .sort((a, b) => a.s - b.s || buildingFirst(a.d) - buildingFirst(b.d) || a.d.name.localeCompare(b.d.name))
    .slice(0, filters.limit ?? DEFAULT_LIMIT)
    .map((r) => r.d);
}
