/* global BarcodeDetector */

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
    'extract-and-search-domain': false,
    'add-image-context': true
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
    title: 'Close Popup after OTP is Copied to the Clipboard',
    id: 'close-after-copy',
    checked: prefs['close-after-copy'],
    parentId: 'settings'
  });
  chrome.contextMenus.create({
    contexts: ['action'],
    type: 'checkbox',
    title: 'Extract Domain to Search for OTPs',
    id: 'extract-and-search-domain',
    checked: prefs['extract-and-search-domain'],
    parentId: 'settings'
  });
  chrome.contextMenus.create({
    contexts: ['action'],
    type: 'checkbox',
    title: 'Add OTP by Scanning QR Code Context Menu',
    id: 'add-image-context',
    checked: prefs['add-image-context'],
    parentId: 'settings'
  });
  chrome.contextMenus.create({
    contexts: ['image'],
    title: 'Add OTP by Scanning QR Code',
    id: 'scan-qr-code',
    visible: prefs['add-image-context']
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
  else if (info.menuItemId === 'scan-qr-code') {
    try {
      if (info.srcUrl.startsWith('http')) {
        const granted = await chrome.permissions.request({
          origins: [info.srcUrl]
        });
        if (!granted) {
          throw Error('User aborted');
        }
      }
      if (!('BarcodeDetector' in this)) {
        throw new Error('Barcode Detector API is not supported in this browser.');
      }
      const supportedFormats = await BarcodeDetector.getSupportedFormats();
      if (!supportedFormats.includes('qr_code')) {
        throw new Error('QR code detection is not supported by this device/browser.');
      }
      chrome.action.setBadgeText({
        text: '...',
        tabId: tab.id
      });
      const qrDetector = new BarcodeDetector({formats: ['qr_code']});
      const response = await fetch(info.srcUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image. Status: ${response.status}`);
      }
      const blob = await response.blob();
      const img = await createImageBitmap(blob);
      const barcodes = await qrDetector.detect(img);
      if (barcodes.length === 0) {
        throw new Error('No QR code detected in the image.');
      }
      const codes = barcodes.map(o => o.rawValue)
        .filter(s => s.startsWith('otpauth://'))
        .filter((s, i, l) => s && l.indexOf(s) === i);
      if (codes.length) {
        await chrome.action.openPopup();
        chrome.runtime.sendMessage({
          method: 'add-otp',
          codes
        });
      }
      else {
        throw Error('No valid QR code detected in the image.');
      }
      chrome.action.setBadgeText({
        text: '',
        tabId: tab.id
      });
    }
    catch (e) {
      console.error(e);
      chrome.action.setBadgeText({
        text: 'E',
        tabId: tab.id
      });
      chrome.action.setBadgeBackgroundColor({
        color: 'red',
        tabId: tab.id
      });
      chrome.action.setTitle({
        title: e.message,
        tabId: tab.id
      });
    }
  }
});

chrome.storage.onChanged.addListener(ps => {
  if ('add-image-context' in ps) {
    chrome.contextMenus.update('scan-qr-code', {
      visible: ps['add-image-context'].newValue
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
