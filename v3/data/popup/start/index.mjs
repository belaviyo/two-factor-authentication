import {AegisVault} from '../aegis/core.mjs';

const open = async (database, keypath) => {
  if (keypath) {
    await chrome.storage.local.set({keypath});
  }

  parent.command({
    cmd: 'navigate',
    href: 'search/index.html',
    data: {
      password: self.password.value,
      keypath,
      database
    }
  });
};

const storage = new Storage('file');
const save = async handle => {
  // only save if it is a new handle
  const handles = await storage.list('handles');

  for (const {value, keypath} of handles) {
    if (await value.isSameEntry(handle)) {
      console.info('handle is already stored');
      return keypath;
    }
  }

  return await storage.put('handles', handle);
};

self.openDB.onclick = async e => {
  e.preventDefault();

  try {
    e.target.disabled = true;

    const prefs = await chrome.storage.local.get({
      'password-on-session': true,
      'handle-on-indexdb': true
    });

    e.target.value = 'Select File...';
    const [handle] = await window.showOpenFilePicker({
      types: [
        {
          description: 'Aegis Vault JSON Files',
          accept: {
            'application/json': ['.json']
          }
        }
      ],
      excludeAcceptAllOption: true,
      multiple: false
    });
    const file = await handle.getFile();
    const json = await new Response(file).json();

    // is password valid?
    e.target.value = 'Processing File...';
    const vault = new AegisVault(json);
    const db = await vault.decrypt(self.password.value);

    // store password?
    if (prefs['password-on-session']) {
      chrome.storage.session.set({
        'password': self.password.value
      });
    }

    // store handle
    let keypath;
    if (prefs['handle-on-indexdb']) {
      e.target.value = 'Storing Handle...';
      keypath = await save(handle);
    }

    open(db, keypath);
  }
  catch (e) {
    console.error(e);
    parent.command({
      cmd: 'notify',
      type: 'error',
      message: e.message || 'Wrong password. Try again...'
    });
    self.password.focus();
  }
  e.target.disabled = false;
  e.target.value = 'Open a Database';
};

self.openRemote.onclick = async e => {
  e.preventDefault();

  try {
    e.target.disabled = true;

    const prefs = await chrome.storage.local.get({
      'password-on-session': true,
      'handle-on-indexdb': true,
      'last-remote-source': ''
    });

    e.target.value = 'Select Source...';
    const href = prompt('Select remote source', prefs['last-remote-source']);
    if (!href) {
      throw Error('User Aborted');
    }
    const handle = Storage.remote({
      kind: 'remote',
      href
    });

    if ((await handle.queryPermission({mode: 'read'})) !== 'granted') {
      throw Error('Permission Denied');
    }

    const file = await handle.getFile();
    const json = await new Response(file).json();

    // is password valid?
    e.target.value = 'Processing File...';
    const vault = new AegisVault(json);
    const db = await vault.decrypt(self.password.value);

    // store password?
    if (prefs['password-on-session']) {
      chrome.storage.session.set({
        'password': self.password.value
      });
    }
    // store remote
    chrome.storage.local.set({
      'last-remote-source': href
    });

    // store handle
    let keypath;
    if (prefs['handle-on-indexdb']) {
      e.target.value = 'Storing Handle...';
      keypath = await save(handle);
    }

    open(db, keypath);
  }
  catch (e) {
    console.error(e);
    parent.command({
      cmd: 'notify',
      type: 'error',
      message: e.message || 'Wrong password. Try again...'
    });
    self.password.focus();
  }
  e.target.disabled = false;
  e.target.value = 'Open Remote';
};

self.createDB.onclick = async e => {
  e.preventDefault();

  try {
    e.target.disabled = true;
    e.target.value = 'Select File...';

    if (self.password.value.length < 4) {
      throw Error('Password is too short!');
    }

    const handle = await window.showSaveFilePicker({
      suggestedName: 'vault.json',
      types: [
        {
          description: 'Aegis Vault JSON Files',
          accept: {
            'application/json': ['.json']
          }
        }
      ],
      excludeAcceptAllOption: true
    });

    const prefs = await chrome.storage.local.get({
      'password-on-session': true,
      'handle-on-indexdb': true
    });

    const cp = prompt('Re-enter the password');
    if (cp !== self.password.value) {
      throw Error('Passwords do not match');
    }

    e.target.value = 'Creating DB...';
    const vault = await AegisVault.create(cp);

    // write JSON
    e.target.value = 'Saving DB...';
    const writable = await handle.createWritable();

    await writable.write(JSON.stringify(vault.vault, null, 2));
    await writable.close();

    // store handle
    e.target.value = 'Storing Handle...';
    const storage = new Storage('file');
    await storage.open([{
      name: 'handles'
    }]);

    let keypath;
    if (prefs['handle-on-indexdb']) {
      keypath = await save(handle);
    }

    const db = await vault.decrypt(cp);

    // store password?
    if (prefs['password-on-session']) {
      chrome.storage.session.set({
        'password': self.password.value
      });
    }

    open(db, keypath);
  }
  catch (e) {
    console.error(e);
    parent.command({
      cmd: 'notify',
      type: 'error',
      message: e.message || 'Wrong password. Try again...'
    });
    self.password.focus();
  }
  e.target.disabled = false;
  e.target.value = 'Create a new Database';
};

self.password.oninput = e => {
  const b = e.target.checkValidity();

  if (b) {
    self.openDB.disabled =
    self.createDB.disabled = typeof FileSystemFileHandle === 'undefined';

    self.openRemote.disabled =
    self.stored.disabled = b === false;
  }
  else {
    self.openDB.disabled =
    self.openRemote.disabled =
    self.createDB.disabled =
    self.stored.disabled = true;
  }
};

chrome.storage.local.get({
  keypath: -1
}).then(async prefs => {
  await storage.open([{
    name: 'handles'
  }]);
  for (const o of await storage.list('handles')) {
    const option = document.createElement('option');
    option.textContent = o.value.name;
    option.handle = o.value;
    option.value = option.keypath = o.keypath;
    if (prefs.keypath === o.keypath) {
      self.last.disabled = false;
      self.last.keypath = o.keypath;
      self.last.title = o.value.name;
    }
    self.stored.append(option);
  }
});

self.stored.onchange = async e => {
  e.preventDefault();

  const option = e.target.selectedOptions[0];
  const {handle, keypath} = option;

  if (handle) {
    try {
      // If already granted, return true
      if ((await handle.queryPermission({mode: 'read'})) !== 'granted') {
        const p = await handle.requestPermission({mode: 'read'});

        if (p !== 'granted') {
          throw Error('Permission is: ' + p);
        }
      }

      // is password valid?
      const file = await handle.getFile();
      const json = await new Response(file).json();

      const vault = new AegisVault(json);
      const db = await vault.decrypt(self.password.value);

      const prefs = await chrome.storage.local.get({
        'password-on-session': true
      });

      // store password?
      if (prefs['password-on-session']) {
        chrome.storage.session.set({
          'password': self.password.value
        });
      }

      open(db, keypath);
    }
    catch (e) {
      console.error(e);
      // remove file
      if (e.name === 'NotFoundError') {
        storage.remove('handles', keypath);
        option.remove();
        e.target.selectedIndex = 0;
      }

      parent.command({
        cmd: 'notify',
        type: 'error',
        message: e.message || 'Wrong password. Try again...'
      });
      self.password.focus();
      self.stored.selectedIndex = 0;
    }
  }
};

self.reset.onclick = () => {
  storage.close();
  const req = indexedDB.deleteDatabase('file');

  req.onsuccess = () => {
    location.reload();
  };
  req.onerror = e => {
    console.error(e);
    alert('Delete failed');
  };
  req.onblocked = () => {
    alert('Delete blocked (open connections still exist)');
  };
};

// restore password
chrome.storage.local.get({
  'handle-on-indexdb': true
}).then(prefs => {
  if (prefs['handle-on-indexdb']) {
    chrome.storage.session.get({
      'password': ''
    }).then(prefs => {
      if (prefs.password) {
        self.password.value = prefs.password;
        self.password.dispatchEvent(new Event('input'));
      }
    });
  }
});

self.last.onclick = e => {
  e.preventDefault();

  self.stored.value = self.last.keypath;
  self.stored.dispatchEvent(new Event('change'));
};

// keyboard support
onkeydown = e => {
  const meta = e.ctrlKey || e.metaKey;

  if (e.key.toLowerCase() === 'o' && meta) {
    e.preventDefault();
    self.openDB.click();

    return;
  }
  if (e.key.toLowerCase() === 'n' && meta) {
    e.preventDefault();
    self.createDB.click();

    return;
  }
  if (e.key.toLowerCase() === 'l' && meta) {
    e.preventDefault();
    self.last.click();

    return;
  }
};

// KeePassHelper
{
  const ua = navigator.userAgent.toLowerCase();
  let id = 'jgnfghanfbjmimbdmnjfofnbcgpkbegj';

  if (ua.includes('firefox')) {
    id = '{69ef9498-0139-43e4-97b8-942982ac9158}';
  }
  else if (ua.includes('edg')) {
    id = 'bfmglfdehkodoiinbclgoppembjfgjkj';
  }
  chrome.storage.local.get({
    'keepasshelper-id': id,
    'keepasshelper-query': 'aegis'
  }).then(async prefs => {
    try {
      await chrome.runtime.sendMessage(id, {
        cmd: 'not-a-command'
      });
      document.querySelector('.two').classList.add('available');
      self.keepasshelper.onclick = () => chrome.runtime.sendMessage({
        cmd: 'kph-get-password',
        prefs
      });
    }
    catch (e) {
      console.error(e);
    }
  });
}
