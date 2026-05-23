const once = async () => {
  if (once.done) {
    return;
  }
  once.done = true;

  const prefs = await chrome.storage.local.get({
    'password-on-session': false,
    'handle-on-indexdb': true,
    'backup-before-save': true
  });

  chrome.contextMenus.create({
    contexts: ['action'],
    type: 'checkbox',
    title: 'Keep the Password in Browser Session Storage',
    id: 'password-on-session',
    checked: prefs['password-on-session']
  });
  chrome.contextMenus.create({
    contexts: ['action'],
    type: 'checkbox',
    title: 'Store Database Handles',
    id: 'handle-on-indexdb',
    checked: prefs['handle-on-indexdb']
  });
  chrome.contextMenus.create({
    contexts: ['action'],
    type: 'checkbox',
    title: 'Backup Database before Overwriting',
    id: 'backup-before-save',
    checked: prefs['backup-before-save']
  });
};
chrome.runtime.onStartup.addListener(once);
chrome.runtime.onInstalled.addListener(once);

chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === 'password-on-session') {
    chrome.storage.local.set({
      'password-on-session': info.checked
    });
  }
  else if (info.menuItemId === 'handle-on-indexdb') {
    chrome.storage.local.set({
      'handle-on-indexdb': info.checked
    });
  }
});
