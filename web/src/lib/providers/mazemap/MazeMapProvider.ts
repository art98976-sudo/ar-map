import type {
  Building,
  Destination,
  Floor,
  Route,
  RouteEndpoint,
  RouteOptions,
  SearchFilters,
} from '../../types';
import { NotImplementedError, ProviderNotConfiguredError } from '../errors';
import type { MapProvider } from '../MapProvider';

export interface MazeMapConfig {
  /** MazeMap campus id. Must be confirmed by the University; never guessed. */
  campusId?: string;
}

/**
 * Placeholder for the official MazeMap integration (Step 7).
 * It stays switched off until the University provides credentials and permission.
 */
export class MazeMapProvider implements MapProvider {
  readonly id = 'mazemap' as const;
  readonly isSampleData = false;

  constructor(private readonly config: MazeMapConfig) {}

  /** True when every value MazeMap needs is present. */
  static isConfigured(config: MazeMapConfig): boolean {
    return Boolean(config.campusId && config.campusId !== 'TODO');
  }

  private notReady(feature: string): never {
    if (!MazeMapProvider.isConfigured(this.config)) {
      throw new ProviderNotConfiguredError('MazeMapProvider', ['MAZEMAP_CAMPUS_ID']);
    }
    throw new NotImplementedError(`MazeMap ${feature} (Step 7)`);
  }

  async searchDestinations(query: string, filters?: SearchFilters): Promise<Destination[]> {
    void query; void filters;
    return this.notReady('search');
  }

  async getDestination(id: string): Promise<Destination | null> {
    void id;
    return this.notReady('destination lookup');
  }

  async getBuildings(): Promise<Building[]> {
    return this.notReady('buildings');
  }

  async getFloors(buildingId: string): Promise<Floor[]> {
    void buildingId;
    return this.notReady('floors');
  }

  async getRoute(from: RouteEndpoint, to: RouteEndpoint, options: RouteOptions): Promise<Route> {
    void from; void to; void options;
    return this.notReady('routing');
  }
}
