export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not implemented yet.`);
    this.name = 'NotImplementedError';
  }
}

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
