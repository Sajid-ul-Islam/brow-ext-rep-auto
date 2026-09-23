export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PANEL_TYPES = new Set([
  'panel.snapshot',
  'session.start', 'session.pause', 'session.resume', 'session.stop',
  'candidate.dismiss', 'candidate.convert',
  'workflow.list', 'workflow.get', 'workflow.save', 'workflow.delete', 'workflow.duplicate', 'workflow.import',
  'run.preview', 'run.start', 'run.confirmStep', 'run.pause', 'run.resume', 'run.stop',
  'data.deleteSession', 'data.clear', 'data.export',
]);

export function fail(code) { throw new Error(code); }

export function exact(value, keys, optional = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const ownKeys = Object.keys(value);
  return keys.every(key => Object.hasOwn(value, key)) && ownKeys.every(k => keys.includes(k) || optional.includes(k));
}

export function originOf(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    if (['chromewebstore.google.com', 'chrome.google.com'].includes(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}

const id = value => typeof value === 'string' && UUID.test(value);
const tabId = value => Number.isSafeInteger(value) && value >= 0;

export function validateMessage(message) {
  if (!exact(message, ['protocolVersion', 'type', 'requestId', 'payload']) || message.protocolVersion !== 1
    || !id(message.requestId) || typeof message.type !== 'string') fail('INVALID_MESSAGE');

  const maxLen = message.type === 'workflow.import' ? 1048576 : 32768;
  if (new TextEncoder().encode(JSON.stringify(message)).length > maxLen) fail('INVALID_MESSAGE');

  const p = message.payload;
  switch (message.type) {
    case 'panel.snapshot':
      if (!exact(p, ['windowId']) || !tabId(p.windowId)) fail('INVALID_MESSAGE');
      break;
    case 'session.start':
      if (!exact(p, ['windowId', 'tabId']) || !tabId(p.windowId) || !tabId(p.tabId)) fail('INVALID_MESSAGE');
      break;
    case 'session.pause': case 'session.resume': case 'session.stop': case 'data.deleteSession':
      if (!exact(p, ['sessionId']) || !id(p.sessionId)) fail('INVALID_MESSAGE');
      break;
    case 'candidate.dismiss':
      if (!exact(p, ['candidateId']) || !id(p.candidateId)) fail('INVALID_MESSAGE');
      break;
    case 'candidate.convert':
      if (!exact(p, ['candidateId'], ['name']) || !id(p.candidateId)) fail('INVALID_MESSAGE');
      break;
    case 'workflow.list':
      if (!exact(p, [])) fail('INVALID_MESSAGE');
      break;
    case 'workflow.get': case 'workflow.delete': case 'workflow.duplicate':
      if (!exact(p, ['workflowId']) || !id(p.workflowId)) fail('INVALID_MESSAGE');
      break;
    case 'workflow.save':
      if (!exact(p, ['workflow']) || typeof p.workflow !== 'object') fail('INVALID_MESSAGE');
      break;
    case 'workflow.import':
      if (!exact(p, ['json']) || typeof p.json !== 'string') fail('INVALID_MESSAGE');
      break;
    case 'run.preview':
      if (!exact(p, ['windowId', 'workflowId']) || !tabId(p.windowId) || !id(p.workflowId)) fail('INVALID_MESSAGE');
      break;
    case 'run.start':
      if (!exact(p, ['windowId', 'workflowId', 'workflowRevision', 'inputs'])
        || !tabId(p.windowId) || !id(p.workflowId) || !Number.isSafeInteger(p.workflowRevision)
        || typeof p.inputs !== 'object' || Array.isArray(p.inputs)) fail('INVALID_MESSAGE');
      break;
    case 'run.confirmStep':
      if (!exact(p, ['runId', 'stepId']) || !id(p.runId) || !id(p.stepId)) fail('INVALID_MESSAGE');
      break;
    case 'run.pause': case 'run.resume': case 'run.stop':
      if (!exact(p, ['runId']) || !id(p.runId)) fail('INVALID_MESSAGE');
      break;
    case 'data.clear': case 'data.export':
      if (!exact(p, [])) fail('INVALID_MESSAGE');
      break;
    case 'observer.end':
      if (!exact(p, ['sessionId', 'reason']) || !id(p.sessionId)
        || !['navigation', 'tabHidden', 'overflow', 'contextLost', 'user'].includes(p.reason)) fail('INVALID_MESSAGE');
      break;
    case 'events.append': {
      if (!exact(p, ['sessionId', 'epoch', 'events']) || !id(p.sessionId) || !id(p.epoch)
        || !Array.isArray(p.events) || p.events.length < 1 || p.events.length > 50) fail('INVALID_MESSAGE');
      let previous = 0;
      for (const event of p.events) {
        if (!exact(event, ['sequence', 'action', 'targetKey', 'fieldKind'])
          || !Number.isSafeInteger(event.sequence) || event.sequence <= previous
          || !['click', 'change'].includes(event.action)
          || typeof event.targetKey !== 'string' || !/^[0-9a-f]{64}$/.test(event.targetKey)
          || !['none', 'select', 'checkbox', 'radio'].includes(event.fieldKind)
          || (event.action === 'change' && event.fieldKind === 'none')) fail('INVALID_MESSAGE');
        previous = event.sequence;
      }
      break;
    }
    case 'executor.outcome':
      if (!exact(p, ['runId', 'dispatchId', 'stepId', 'status'], ['code', 'details'])
        || !id(p.runId) || !id(p.dispatchId) || !id(p.stepId)
        || !['success', 'failed'].includes(p.status)) fail('INVALID_MESSAGE');
      break;
    default: fail('INVALID_MESSAGE');
  }
  return message;
}

export function isPanelSender(sender, runtime) {
  return sender?.id === runtime.id && sender.url === runtime.getURL('sidepanel.html');
}

export function isSessionSender(sender, session, runtime) {
  return sender?.id === runtime.id && sender.tab?.id === session.tabId && sender.frameId === 0
    && sender.documentId === session.documentId && originOf(sender.url) === session.origin
    && (!sender.origin || sender.origin === session.origin)
    && (!sender.documentLifecycle || sender.documentLifecycle === 'active');
}

export function isRunSender(sender, run, runtime) {
  return sender?.id === runtime.id && sender.tab?.id === run.tabId && sender.frameId === 0
    && sender.documentId === run.documentId && originOf(sender.url) === run.origin
    && (!sender.origin || sender.origin === run.origin)
    && (!sender.documentLifecycle || sender.documentLifecycle === 'active');
}

export function envelope(type, payload) {
  return { protocolVersion: 1, type, requestId: crypto.randomUUID(), payload };
}
