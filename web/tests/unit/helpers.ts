import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DataSource } from '@/lib/data/dataSource';

const DATA_DIR = join(__dirname, '..', '..', 'public', 'data');

/** Reads sample data straight from disk, as the browser would over /data. */
export const fsDataSource: DataSource = {
  async loadJson<T>(path: string): Promise<T> {
    return readJson<T>(path);
  },
};

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, path), 'utf8')) as T;
}
