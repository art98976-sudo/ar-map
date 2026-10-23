/** Loads JSON files from the sample dataset. Lets tests read from disk and the browser fetch over HTTP. */
export interface DataSource {
  loadJson<T>(path: string): Promise<T>;
}

/** Fetches files served from /public/data (i.e. the /data URL). */
export function createFetchDataSource(baseUrl = '/data'): DataSource {
  return {
    async loadJson<T>(path: string): Promise<T> {
      const res = await fetch(`${baseUrl}/${path}`);
      if (!res.ok) throw new Error(`Could not load ${path} (HTTP ${res.status})`);
      return (await res.json()) as T;
    },
  };
}
