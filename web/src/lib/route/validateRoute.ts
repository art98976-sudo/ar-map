import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import routeSchema from '../../../public/data/schemas/route.schema.json';
import type { Route } from '../types';

export interface RouteValidationResult {
  valid: boolean;
  errors: string[];
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const validateSchema = ajv.compile<Route>(routeSchema);

/** Allowed gap between the route total and the sum of its steps (rounding). */
const TOTAL_TOLERANCE_METRES = 1;
const TOTAL_TOLERANCE_SECONDS = 2;

/**
 * Checks a route against route.schema.json, then against rules a JSON Schema
 * cannot express: step order, a final "arrive" step and consistent totals.
 */
export function validateRoute(candidate: unknown): RouteValidationResult {
  if (!validateSchema(candidate)) {
    return {
      valid: false,
      errors: (validateSchema.errors ?? []).map((e) => `${e.instancePath || '(route)'} ${e.message ?? 'is invalid'}`),
    };
  }

  const route = candidate;
  const errors: string[] = [];

  route.steps.forEach((step, i) => {
    if (step.index !== i) errors.push(`/steps/${i}/index should be ${i}, found ${step.index}`);
    if (step.type === 'arrive' && i !== route.steps.length - 1) {
      errors.push(`/steps/${i} "arrive" must be the last step`);
    }
    if (step.type === 'change-floor' && step.floorChange && step.floorChange.fromLevel === step.floorChange.toLevel) {
      errors.push(`/steps/${i} change-floor must change level`);
    }
  });

  if (route.steps[route.steps.length - 1].type !== 'arrive') {
    errors.push('/steps the last step must be "arrive"');
  }

  const sumDistance = route.steps.reduce((s, step) => s + step.distanceMetres, 0);
  if (Math.abs(sumDistance - route.distanceMetres) > TOTAL_TOLERANCE_METRES) {
    errors.push(`/distanceMetres ${route.distanceMetres} does not match the step total ${sumDistance.toFixed(1)}`);
  }
  const sumDuration = route.steps.reduce((s, step) => s + step.durationSeconds, 0);
  if (Math.abs(sumDuration - route.durationSeconds) > TOTAL_TOLERANCE_SECONDS) {
    errors.push(`/durationSeconds ${route.durationSeconds} does not match the step total ${sumDuration}`);
  }

  return { valid: errors.length === 0, errors };
}

/** Throws with readable messages when the route is invalid. */
export function assertValidRoute(candidate: unknown): asserts candidate is Route {
  const result = validateRoute(candidate);
  if (!result.valid) throw new Error(`Invalid route:\n- ${result.errors.join('\n- ')}`);
}
