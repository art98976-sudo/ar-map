export class ProviderNotConfiguredError extends Error {
  constructor(provider: string, missing: string[]) {
    super(`${provider} is not configured. Missing: ${missing.join(', ')}.`);
    this.name = 'ProviderNotConfiguredError';
  }
}

export class NotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`${what} "${id}" was not found.`);
    this.name = 'NotFoundError';
  }
}

/** No path exists between the two points (for example, no step-free way in). */
export class NoRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoRouteError';
  }
}

/** A position is too far from any mapped path to route from it. */
export class OutOfAreaError extends Error {
  constructor(public readonly distanceMetres: number) {
    super(`This position is about ${Math.round(distanceMetres)} m from the nearest campus path.`);
    this.name = 'OutOfAreaError';
  }
}
