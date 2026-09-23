/**
 * Pure declarative workflow validator and conversion module (M3).
 * Operates with no DOM, storage, or network dependencies.
 */

export const MAX_STEPS = 30;
export const MAX_PARAMETERS = 30;
export const STEP_TYPES = new Set(['click', 'fill', 'select', 'setChecked', 'waitFor']);
export const LOCATOR_TYPES = new Set(['testAttribute', 'roleAndName', 'id', 'css']);
export const EFFECT_TYPES = new Set(['local', 'external', 'unknown']);
export const PARAMETER_TYPES = new Set(['text', 'number', 'boolean', 'option']);
export const WAIT_CONDITIONS = new Set(['visible', 'hidden', 'enabled', 'checked']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PARAMETER_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

function fail(code = 'INVALID_WORKFLOW') {
  throw new Error(code);
}

function exact(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (required.some((k) => !Object.hasOwn(value, k)) || keys.some((k) => !required.includes(k) && !optional.includes(k))) fail();
}

function checkUUID(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail();
}

function checkTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail();
}

function checkOrigin(value) {
  if (typeof value !== 'string' || value.length > 2048) fail();
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || value !== url.origin) fail();
  } catch {
    fail();
  }
}

/**
 * Validates a single locator alternative.
 */
export function validateLocator(locator) {
  exact(locator, ['type', 'value'], ['attributeName']);
  if (!LOCATOR_TYPES.has(locator.type)) fail();
  if (typeof locator.value !== 'string' || locator.value.length < 1 || locator.value.length > 256) fail();
  if (locator.type === 'testAttribute') {
    if (typeof locator.attributeName !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(locator.attributeName)) fail();
  }
}

/**
 * Validates a step target object.
 */
export function validateTarget(target) {
  exact(target, ['reviewedAt', 'locators']);
  checkTimestamp(target.reviewedAt);
  if (!Array.isArray(target.locators) || target.locators.length < 1 || target.locators.length > 4) fail();
  for (const locator of target.locators) {
    validateLocator(locator);
  }
}

/**
 * Validates a parameter definition.
 */
export function validateParameter(param) {
  exact(param, ['name', 'label', 'type', 'required'], ['options', 'defaultValue']);
  if (typeof param.name !== 'string' || !PARAMETER_NAME.test(param.name)) fail();
  if (typeof param.label !== 'string' || param.label.length < 1 || param.label.length > 120) fail();
  if (!PARAMETER_TYPES.has(param.type)) fail();
  if (typeof param.required !== 'boolean') fail();

  if (param.type === 'option') {
    if (!Array.isArray(param.options) || param.options.length < 1 || param.options.length > 50) fail();
    for (const opt of param.options) {
      if (typeof opt !== 'string' || opt.length > 120) fail();
    }
  }

  if (Object.hasOwn(param, 'defaultValue') && param.defaultValue !== undefined && param.defaultValue !== null) {
    if (param.type === 'number' && !Number.isFinite(param.defaultValue)) fail();
    if (param.type === 'boolean' && typeof param.defaultValue !== 'boolean') fail();
    if ((param.type === 'text' || param.type === 'option') && typeof param.defaultValue !== 'string') fail();
  }
}

/**
 * Validates a workflow step.
 */
export function validateStep(step, parameterNames = new Set()) {
  exact(step, ['id', 'type', 'effect', 'timeoutMs'], ['target', 'parameter', 'value', 'postcondition', 'label']);
  checkUUID(step.id);
  if (!STEP_TYPES.has(step.type)) fail();
  if (!EFFECT_TYPES.has(step.effect)) fail();
  if (!Number.isSafeInteger(step.timeoutMs) || step.timeoutMs < 100 || step.timeoutMs > 30000) fail();

  if (step.type !== 'waitFor') {
    if (!step.target) fail();
    validateTarget(step.target);
  }

  if (step.parameter !== undefined && step.parameter !== null) {
    if (typeof step.parameter !== 'string' || !parameterNames.has(step.parameter)) fail();
  }

  if (step.postcondition) {
    exact(step.postcondition, ['condition', 'expected']);
    if (!WAIT_CONDITIONS.has(step.postcondition.condition)) fail();
    if (typeof step.postcondition.expected !== 'boolean') fail();
  }

  if (step.label !== undefined && step.label !== null) {
    if (typeof step.label !== 'string' || step.label.length > 120) fail();
  }
}

/**
 * Validates a complete Workflow object.
 */
export function validateWorkflow(workflow) {
  exact(workflow, [
    'schemaVersion', 'id', 'revision', 'name', 'origin', 'reviewedPath',
    'steps', 'parameters', 'createdAt', 'updatedAt', 'reviewedRevision', 'reviewedAt',
  ]);

  if (workflow.schemaVersion !== 1) fail();
  checkUUID(workflow.id);
  if (!Number.isSafeInteger(workflow.revision) || workflow.revision < 1) fail();
  if (typeof workflow.name !== 'string' || workflow.name.trim().length < 1 || workflow.name.length > 120) fail();
  checkOrigin(workflow.origin);

  if (workflow.reviewedPath !== null) {
    if (typeof workflow.reviewedPath !== 'string' || !workflow.reviewedPath.startsWith('/') || /[\?#\s]/.test(workflow.reviewedPath)) fail();
  }

  if (!Array.isArray(workflow.parameters) || workflow.parameters.length > MAX_PARAMETERS) fail();
  const paramNames = new Set();
  for (const param of workflow.parameters) {
    validateParameter(param);
    if (paramNames.has(param.name)) fail();
    paramNames.add(param.name);
  }

  if (!Array.isArray(workflow.steps) || workflow.steps.length < 1 || workflow.steps.length > MAX_STEPS) fail();
  const stepIds = new Set();
  for (const step of workflow.steps) {
    validateStep(step, paramNames);
    if (stepIds.has(step.id)) fail();
    stepIds.add(step.id);
  }

  checkTimestamp(workflow.createdAt);
  checkTimestamp(workflow.updatedAt);

  if (workflow.reviewedRevision !== null) {
    if (!Number.isSafeInteger(workflow.reviewedRevision) || workflow.reviewedRevision !== workflow.revision) fail();
    if (workflow.reviewedAt === null) fail();
    checkTimestamp(workflow.reviewedAt);
  } else {
    if (workflow.reviewedAt !== null) fail();
  }

  return workflow;
}

/**
 * Determines whether a step requires user confirmation prior to dispatch.
 */
export function requiresConfirmation(step) {
  if (step.effect === 'external' || step.effect === 'unknown') return true;
  return false;
}

/**
 * Converts a Candidate suggestion into an initial draft Workflow.
 */
export function createWorkflowFromCandidate(candidate, {
  origin,
  name = `Repeated task (${candidate.symbols.length} steps)`,
  uuid = () => crypto.randomUUID(),
  now = () => Date.now(),
} = {}) {
  const time = new Date(now()).toISOString();
  const steps = candidate.symbols.map((sym, index) => {
    let type = 'click';
    let effect = 'unknown';
    if (sym.action === 'change') {
      if (sym.fieldKind === 'checkbox' || sym.fieldKind === 'radio') {
        type = 'setChecked';
        effect = 'local';
      } else if (sym.fieldKind === 'select') {
        type = 'select';
        effect = 'local';
      } else {
        type = 'fill';
        effect = 'local';
      }
    }

    return {
      id: uuid(),
      type,
      effect,
      timeoutMs: 5000,
      label: `Step ${index + 1}: ${type} control`,
      target: {
        reviewedAt: time,
        locators: [
          { type: 'css', value: `[data-target-key="${sym.targetKey}"]` },
        ],
      },
      postcondition: { condition: 'visible', expected: true },
    };
  });

  return {
    schemaVersion: 1,
    id: uuid(),
    revision: 1,
    name: name.slice(0, 120),
    origin,
    reviewedPath: null,
    steps,
    parameters: [],
    createdAt: time,
    updatedAt: time,
    reviewedRevision: null,
    reviewedAt: null,
  };
}
