const once = async () => {
  if (once.done) {
    return;
  }
  once.done = true;

  const prefs = await chrome.storage.local.get({
    'password-on-session': true,
    'handle-on-indexdb': true,
    'backup-before-save': true,
    'close-after-copy': true,
    'extract-and-search-domain': false
  });

  chrome.contextMenus.create({
    contexts: ['action'],
    title: 'Open in Tab',
    id: 'open-in-tab'
  });
  chrome.contextMenus.create({
    contexts: ['action'],
    title: 'Settings',
    id: 'settings'
  });
  chrome.contextMenus.create({
    contexts: ['action'],
    type: 'checkbox',
    title: 'Keep the Password in Browser Session Storage',
    id: 'password-on-session',
    checked: prefs['password-on-session'],
    parentId: 'settings'
  });
  chrome.contextMenus.create({
    contexts: ['action'],
    type: 'checkbox',
    title: 'Store Database Handles',
    id: 'handle-on-indexdb',
    checked: prefs['handle-on-indexdb'],
    parentId: 'settings'
  });
  chrome.contextMenus.create({
    contexts: ['action'],
    type: 'checkbox',
    title: 'Backup Database before Overwriting',
    id: 'backup-before-save',
    checked: prefs['backup-before-save'],
    parentId: 'settings'
  });
  chrome.contextMenus.create({
    contexts: ['action'],
    type: 'checkbox',
    title: 'Close the popup after the OTP is copied to the clipboard',
    id: 'close-after-copy',
    checked: prefs['close-after-copy'],
    parentId: 'settings'
  });
  chrome.contextMenus.create({
    contexts: ['action'],
    type: 'checkbox',
    title: 'Extract domain to search for OTPs',
    id: 'extract-and-search-domain',
    checked: prefs['extract-and-search-domain'],
    parentId: 'settings'
  });
};
chrome.runtime.onStartup.addListener(once);
chrome.runtime.onInstalled.addListener(once);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'extract-and-search-domain') {
    if (info.checked) {
      const granted = await chrome.permissions.request({
        permissions: ['activeTab']
      });
      if (!granted) {
        throw Error('USER_ABORT');
      }
    }
    else {
      await chrome.permissions.remove({
        permissions: ['activeTab']
      });
    }
  }

  if ('checked' in info) {
    chrome.storage.local.set({
      [info.menuItemId]: info.checked
    });
  }
  else if (info.menuItemId === 'open-in-tab') {
    chrome.tabs.create({
      url: 'data/popup/index.html',
      index: tab.index + 1
    });
  }
});

/* FAQs & Feedback */
{
  const {management, runtime: {onInstalled, setUninstallURL, getManifest}, storage, tabs} = chrome;
  if (navigator.webdriver !== true) {
    const {homepage_url: page, name, version} = getManifest();
    onInstalled.addListener(({reason, previousVersion}) => {
      management.getSelf(({installType}) => installType === 'normal' && storage.local.get({
        'faqs': true,
        'last-update': 0
      }, prefs => {
        if (reason === 'install' || (prefs.faqs && reason === 'update')) {
          const doUpdate = (Date.now() - prefs['last-update']) / 1000 / 60 / 60 / 24 > 45;
          if (doUpdate && previousVersion !== version) {
            tabs.query({active: true, lastFocusedWindow: true}, tbs => tabs.create({
              url: page + '?version=' + version + (previousVersion ? '&p=' + previousVersion : '') + '&type=' + reason,
              active: reason === 'install',
              ...(tbs && tbs.length && {index: tbs[0].index + 1})
            }));
            storage.local.set({'last-update': Date.now()});
          }
        }
      }));
    });
    setUninstallURL(page + '?rd=feedback&name=' + encodeURIComponent(name) + '&version=' + version);
  }
}
