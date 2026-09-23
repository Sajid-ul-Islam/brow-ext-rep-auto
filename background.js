import { createCoordinator } from './lib/coordinator.js';
import { createRepository } from './lib/repository.js';

const coordinator = createCoordinator({ api: chrome, repository: createRepository() });
// Register synchronously so Chrome can wake an idle worker.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  coordinator.handle(message, sender).then(sendResponse);
  return true;
});
chrome.action.onClicked.addListener(tab => {
  // Keep open() inside the toolbar user gesture. Start still requires consent.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => console.error('RepeatFlow could not open the panel.'));
});
chrome.runtime.onInstalled.addListener(() => { void coordinator.lifecycle('restart'); });
chrome.runtime.onStartup.addListener(() => { void coordinator.lifecycle('restart'); });
chrome.tabs.onActivated.addListener(info => { void coordinator.lifecycle('activated', info.tabId); });
chrome.tabs.onRemoved.addListener(tabId => { void coordinator.lifecycle('removed', tabId); });
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading' || Object.hasOwn(change, 'url')) void coordinator.lifecycle('navigation', tabId);
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => console.error('RepeatFlow could not configure its toolbar action.'));
