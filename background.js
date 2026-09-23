// Reapply configuration whenever the worker starts; neither call writes user settings.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  console.error("RepeatFlow could not configure the toolbar action. Reload the extension.");
});

chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {
  console.error("RepeatFlow could not restrict settings access. Reload the extension.");
});
