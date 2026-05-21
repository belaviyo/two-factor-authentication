import {AegisVault} from '../aegis/core.mjs';

const open = database => {
  parent.navigateTo('search/index.html', {
    database,
    password: self.password.value
  });
};

const storage = new Storage('file');
const save = async handle => {
  // only save if it is a new handle
  const handles = await storage.list('handles');
  for (const {value} of handles) {
    if (await value.isSameEntry(handle)) {
      console.info('handle is already stored');
      return;
    }
  }
  await storage.put('handles', handle);
};

self.openDB.onclick = async e => {
  try {
    e.target.disabled = true;

    const prefs = await chrome.storage.local.get({
      'password-on-session': false,
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
    if (prefs['handle-on-indexdb']) {
      e.target.value = 'Storing Handle...';
      await save(handle);
    }

    open(db);
  }
  catch (e) {
    console.error(e);
    self.toast.notify(e.message || 'Wrong password. Try again...', 'error');
    self.password.focus();
  }
  e.target.disabled = false;
  e.target.value = 'Open a Database';
};

self.createDB.onclick = async e => {
  try {
    const cp = prompt('Re-enter the password');
    if (cp !== self.password.value) {
      throw Error('Passwords do not match');
    }

    const prefs = await chrome.storage.local.get({
      'password-on-session': false,
      'handle-on-indexdb': true
    });

    e.target.disabled = true;
    e.target.value = 'Select File...';
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

    if (prefs['handle-on-indexdb']) {
      await save(handle);
    }

    const db = await vault.decrypt(cp);

    // store password?
    if (prefs['password-on-session']) {
      chrome.storage.session.set({
        'password': self.password.value
      });
    }

    open(db);
  }
  catch (e) {
    console.error(e);
    self.toast.notify(e.message || 'Wrong password. Try again...', 'error');
    self.password.focus();
  }
  e.target.disabled = false;
  e.target.value = 'Create a new Database';
};

self.password.oninput = e => {
  const b = e.target.checkValidity();
  self.openDB.disabled = self.stored.disabled = b === false;
};

storage.open([{
  name: 'handles'
}]).then(async () => {
  for (const o of await storage.list('handles')) {
    const option = document.createElement('option');
    option.textContent = o.value.name;
    option.handle = o.value;
    option.keypath = o.keypath;
    self.stored.append(option);
  }
});

self.stored.onchange = async e => {
  const option = e.target.selectedOptions[0];
  const {handle, keypath} = option;
  if (handle) {
    try {
      const prefs = await chrome.storage.local.get({
        'password-on-session': false
      });

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

      // store password?
      if (prefs['password-on-session']) {
        chrome.storage.session.set({
          'password': self.password.value
        });
      }

      open(db);
    }
    catch (e) {
      console.error(e);
      // remove file
      if (e.name === 'NotFoundError') {
        storage.remove('handles', keypath);
        option.remove();
        e.target.selectedIndex = 0;
      }

      self.toast.notify(e.message || 'Wrong password. Try again...', 'error');
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
