/* global otplib, tld, BarcodeDetector */

import {AegisVault} from '../aegis/core.mjs';
import {prompt} from '../prompt.mjs';
import Fuse from './fuse.min.mjs';

if (top.args.get('mode') === 'detached') {
  document.body.classList.add('detached');
}

const groups = new Map();
const icons = new Map();
const map = new Map();

const current = {};

// generate hash for icon
const iconHashFromEntry = async entry => {
  const binary = atob(entry.icon);
  const iconBytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    iconBytes[i] = binary.charCodeAt(i);
  }

  const mimeBytes = new TextEncoder().encode(entry['icon_mime']);

  const combined = new Uint8Array(
    mimeBytes.length + iconBytes.length
  );

  combined.set(mimeBytes, 0);
  combined.set(iconBytes, mimeBytes.length);

  const hash = await crypto.subtle.digest('SHA-256', combined);

  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
};

const sorting = {
  name: 'name',
  direction: 1,
  perform(entries) {
    entries.sort((a, b) => {
      const af = a[sorting.name].trim();
      const bf = b[sorting.name].trim();
      return af.localeCompare(bf) * sorting.direction;
    });
    start(entries);
    if (sorting.name === 'name') {
      document.getElementById('sort-by-name').textContent = 'Name ' + (sorting.direction === 1 ? '↓' : '↑');
      document.getElementById('sort-by-issuer').textContent = 'Issuer';
    }
    else if (sorting.name === 'issuer') {
      document.getElementById('sort-by-name').textContent = 'Name';
      document.getElementById('sort-by-issuer').textContent = 'Issuer ' + (sorting.direction === 1 ? '↓' : '↑');
    }
  }
};

const changed = () => {
  self.save.disabled = false;
  onbeforeunload = e => {
    e.preventDefault();
    // required for Chrome
    return (e.returnValue = '');
  };
};

const start = async entries => {
  // clean
  self.tbody.textContent = '';
  map.clear();
  icons.clear();

  for (let n = 0; n < entries.length; n += 1) {
    const entry = entries[n];

    const clone = document.importNode(self.entry.content, true);
    const name = clone.querySelector('[name=name]');
    name.title = name.textContent = entry.name;

    const issuer = clone.querySelector('[name=issuer]');
    issuer.title = issuer.textContent = entry.issuer;

    if (entry.icon) {
      clone.querySelector('[name=icon]').src = `data:${entry['icon_mime']};base64,` + entry.icon;

      if (icons.has(entry['icon_hash']) === false) {
        // fix old wrong generated hashes
        if (entry['icon_hash'].length !== 64) {
          entry['icon_hash'] = await iconHashFromEntry(entry);
          console.info('wrong icon hash detected', entry['icon_hash']);
        }

        icons.set(entry['icon_hash'], {
          'icon': entry.icon,
          'icon_mime': entry['icon_mime']
        });
      }
    }

    const g = clone.querySelector('[name=groups]');
    g.title = g.textContent = entry.groups.map(s => groups.get(s)).join(', ');

    const e = clone.querySelector('input[type=radio]');
    e.entry = entry;

    const label = clone.firstElementChild;
    label.setAttribute('order', n);
    map.set(n, label);
    self.tbody.append(label);

    if (entry.selected) {
      e.checked = true;
      e.dispatchEvent(new Event('change', {bubbles: true}));
      delete entry.selected;
    }
  }

  // search
  const fuse = new Fuse(entries, {
    keys: ['name', 'issuer', 'groups'],
    useTokenSearch: true,
    threshold: 0.1,
    includeScore: true,
    includeMatches: true
  });
  const reset = () => {
    for (const label of map.values()) {
      label.classList.remove('nomatch');
      self.tbody.appendChild(label); // re-order labels
    }
    if (map.size) {
      map.get(0).querySelector('input[type=radio]').checked = true;
      map.get(0).querySelector('input[type=radio]').dispatchEvent(new Event('change', {bubbles: true}));
    }
  };

  self.search.oninput = e => {
    const {value} = e.target;
    if (value) {
      const results = fuse.search(value);

      if (results.length) {
        const ids = results.map(o => o.refIndex);
        map.get(ids.at(0)).querySelector('input[type=radio]').checked = true;
        map.get(ids.at(0)).querySelector('input[type=radio]').dispatchEvent(new Event('change', {bubbles: true}));
        // hide no matches
        for (const [index, label] of map.entries()) {
          if (ids.includes(index)) {
            label.classList.remove('nomatch');
          }
          else {
            label.classList.add('nomatch');
          }
        }
        // re-order
        for (const result of results) {
          const label = map.get(result.refIndex);
          self.tbody.appendChild(label); // re-order labels
        }
      }
      else {
        reset();
      }
    }
    else {
      reset();
    }
  };
  const radio = self.tbody.querySelector('input[type=radio]:checked');
  if (radio) {
    radio.scrollIntoViewIfNeeded();
  }
  else {
    map.get(0)?.click();
  }
  self.search.focus();

  // add custom icons
  fetch('icons/map.json').then(r => r.json()).then(json => {
    for (const [hash, o] of Object.entries(json)) {
      const {path, mime} = o;

      if (icons.has(hash) === false) {
        icons.set(hash, {
          'path': 'icons/' + path,
          'icon_mime': mime
        });
      }
      else {
        icons.get(hash).path = 'icons/' + path;
      }
    }
  });

  // search active tab
  if (top.args.get('mode') === 'detached') {
    if (top.args.has('query')) {
      self.search.value = top.args.get('query');
      self.search.select();
      self.search.dispatchEvent(new Event('input'));
    }
  }
  else {
    try {
      const tabs = await chrome.tabs.query({active: true, lastFocusedWindow: true});
      if (tabs.length && tabs[0].url) {
        const domain = tld.getDomain(tabs[0].url);
        if (domain) {
          self.search.value = domain;
          self.search.select();
          self.search.dispatchEvent(new Event('input'));
        }
      }
    }
    catch (e) {}
  }
};

onmessage = e => {
  const {database, keypath, password, codes} = e.data;

  for (const group of database.groups) {
    groups.set(group.uuid, group.name);
  }

  sorting.perform(database.entries);
  // start(database.entries);

  self.save.onclick = async e => {
    try {
      const prefs = await chrome.storage.local.get({
        'backup-before-save': true
      });

      e.target.disabled = true;

      e.target.value = 'Open handle...';
      const storage = new Storage('file');
      await storage.open([{
        name: 'handles'
      }]);

      const o = await storage.read('handles', keypath);
      const handle = o.value;

      e.target.value = 'Ask permission...';
      const p = await handle.queryPermission({mode: 'readwrite'});
      if (p !== 'granted') {
        const p = await handle.requestPermission({mode: 'readwrite'});
        if (p !== 'granted') {
          throw Error('Permission is: ' + p);
        }
      }

      e.target.value = 'Read file...';
      const file = await handle.getFile();
      const json1 = await new Response(file).json();

      // backup
      if (prefs['backup-before-save']) {
        const blob = new Blob([JSON.stringify(json1, null, '  ')], {type: 'application/json'});

        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = handle.name.replace('.json', '-' + Date.now() + '.json');
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(a.href);
        a.remove();
      }

      // is password valid?
      e.target.value = 'Decrypt...';
      const vault = new AegisVault(json1);
      await vault.decrypt(password);

      // build groups
      database.groups = [];
      for (const [uuid, name] of groups.entries()) {
        database.groups.push({uuid, name});
      }
      // clean up
      database.entries = database.entries.filter(o => o.deleted !== true);

      e.target.value = 'Encrypt...';
      const json2 = await vault.encrypt(password, database);

      e.target.value = 'Saving DB...';
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(json2, null, 2));
      await writable.close();

      e.target.value = 'Save';
      onbeforeunload = undefined;
      self.save.disabled = true;
    }
    catch (e) {
      console.error(e);
      self.save.disabled = false;
      parent.command({
        cmd: 'notify',
        type: 'error',
        message: e.message
      });
    }
  };

  document.addEventListener('sort', () => sorting.perform(database.entries));

  document.addEventListener('entry', e => {
    database.entries.push(e.detail);
    sorting.perform(database.entries, e.detail.uuid);
  });

  // add new otps
  for (const code of codes) {
    try {
      addFromURI(code);
      parent.command({
        cmd: 'notify',
        type: 'info',
        message: 'New OTP is added. Make sure to review and save if needed.'
      });
    }
    catch (e) {
      console.error(e);
      parent.command({
        cmd: 'notify',
        type: 'error',
        message: e.message
      });
    }
  }
};

// keyboard support
onkeydown = e => {
  const meta = e.ctrlKey || e.metaKey;

  const dlg = document.querySelector('dialog:open');
  if (e.key === 'Escape' && dlg.open) {
    e.preventDefault();
    self.editor.close();
    return;
  }
  if (e.key.toLowerCase() === 'f' && meta) {
    e.preventDefault();
    self.search.focus();

    return;
  }
  if (e.key.toLowerCase() === 'c' && meta) {
    e.preventDefault();
    self.copy.click();

    return;
  }
  if (e.key.toLowerCase() === 'e' && meta) {
    e.preventDefault();
    self.edit.click();
  }
  if (e.key.toLowerCase() === 's' && meta) {
    e.preventDefault();
    self.save.click();
  }

  // If search input is focused
  const active = document.activeElement;
  if (active === self.search) {
    // move to table body on specific keys (recommended)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      self.tbody.querySelector('input:checked')?.focus();
      return;
    }
  }
};
self.tbody.ondblclick = () => self.copy.click();

// generate otp
const generate = entry => {
  if (current.entry !== entry) {
    current.entry = entry;

    if (entry.type === 'totp') {
      entry.info.period = entry.info.period || 30;
    }

    const now = (Date.now() / 1000);
    const timeIntoPeriod = now % entry.info.period;
    self.progress.style.setProperty('--period', entry.info.period + 's');
    self.progress.style.setProperty('--initial', -timeIntoPeriod + 's');
    self.progress.classList.remove('progress');
    void self.progress.offsetWidth; // reset
    self.progress.classList.add('progress');

    generate.run();
    self.copy.disabled = false;
    self.send.disabled = Boolean(top.port) === false;
    self.edit.disabled = false;
    self.delete.disabled = false;
  }
};
generate.run = async () => {
  const {entry} = current;


  if (!entry) {
    return;
  }

  const format = token => {
    return token.length >= 6 && token.length % 2 === 0 ?
      token.slice(0, token.length / 2) + ' ' + token.slice(token.length / 2) : token;
  };
  try {
    const token = generate.token = await otplib.generate({
      secret: entry.info.secret,
      strategy: entry.type, // "totp" or "hotp"

      // HOTP only (ignored for TOTP)
      counter: entry.type === 'hotp' ? entry.info.counter : undefined,

      // TOTP config
      period: entry.info.period,
      digits: entry.info.digits,
      algorithm: entry.info.algo.toLowerCase(), // "sha1"
      guardrails: otplib.createGuardrails({
        MIN_SECRET_BYTES: 1
      })
    });
    self.code.textContent = format(token);
  }
  catch (e) {
    console.error(e);
    self.code.textContent = e.message;
  }
};
generate.stop = () => {
  self.progress.classList.remove('progress');
  self.copy.disabled = true;
  self.send.disabled = true;
  self.edit.disabled = true;
  self.delete.disabled = true;
  delete current.entry;
};
document.onchange = e => {
  const {entry} = e.target;
  if (entry) {
    generate(entry);
  }
  else if (!current.entry) {
    generate.stop();
    self.code.textContent = 'Select an item to show OTP';
  }
};
self.progress.addEventListener('animationend', () => {
  if (current.entry) {
    self.progress.style.setProperty('--initial', '0s');

    self.progress.classList.remove('progress');
    void self.progress.offsetWidth; // reset
    self.progress.classList.add('progress');

    generate.run();
  }
});

// copy
{
  let id;
  self.copy.onclick = async e => {
    clearTimeout(id);
    try {
      await navigator.clipboard.writeText(generate.token);
      e.target.textContent = 'Done';
    }
    catch (e) {
      console.error(e);
      e.target.textContent = 'Error';
    }

    const prefs = await chrome.storage.local.get({
      'close-after-copy': true
    });

    if (prefs['close-after-copy']) {
      if (top.args.get('mode') === 'popup') {
        top.close();
      }
    }

    id = setTimeout(() => {
      e.target.textContent = 'Copy OTP';
    }, 750);
  };
}

// send
self.send.onclick = async () => {
  await top.port.postMessage({
    cmd: 'otp',
    value: generate.token
  });
  top.close();
};

// edit
const commands = {
  'remove-groups': []
};
self.edit.onclick = () => {
  // reset
  commands['remove-groups'].length = 0;

  self.editor.querySelector('input[name=name]').value = current.entry.name;
  self.editor.querySelector('input[name=issuer]').value = current.entry.issuer;
  self.editor.querySelector('select[name=groups]').textContent = '';
  for (const [uuid, name] of groups.entries()) {
    const option = document.createElement('option');
    option.value = uuid;
    option.textContent = name;
    option.selected = current.entry.groups.includes(uuid);
    self.editor.querySelector('select[name=groups]').append(option);
  }
  self.editor.querySelector('select[name=groups]').dispatchEvent(new Event('change'));

  const hash = current.entry['icon_hash'];
  self.editor.querySelector('fieldset[name=icons]').textContent = '';
  for (const [uuid, o] of icons.entries()) {
    const clone = document.importNode(self.img.content, true);
    if ('icon' in o) {
      clone.querySelector('img').src = `data:${o['icon_mime']};base64,` + o.icon;
    }
    else {
      clone.querySelector('img').src = o.path;
    }

    if ('path' in o) {
      clone.querySelector('img').title = o.path.split('/').pop();
    }

    const input = clone.querySelector('input[type=radio]');
    input.value = uuid;
    if (hash && hash === uuid) {
      input.checked = true;
    }
    self.editor.querySelector('fieldset[name=icons]').append(clone.firstElementChild);
  }

  self.editor.querySelector('input[name=find-icon]').onclick = () => {
    let issuer = self.editor.querySelector('input[name=issuer]').value.toLowerCase();

    // convert issuer from hostname to name
    if (issuer.includes('.')) {
      try {
        const suffix = tld.getPublicSuffix(issuer);
        if (suffix) {
          issuer = tld.getDomain(issuer).replace('.' + suffix, '');
        }
      }
      catch (e) {}
    }

    if (issuer) {
      for (const [uuid, o] of icons.entries()) {
        if (o.path) {
          if (o.path.toLowerCase().includes(issuer)) {
            const e = self.editor.querySelector('fieldset[name=icons]').querySelector(`input[value="${uuid}"]`);
            if (e) {
              e.checked = true;
              e.scrollIntoViewIfNeeded();
            }
            return;
          }
        }
      }
      parent.command({
        cmd: 'notify',
        type: 'info',
        message: 'Cannot find any icon for "' + issuer + '"'
      });
    }
    else {
      parent.command({
        cmd: 'notify',
        type: 'error',
        message: 'This entry does not have an issuer'
      });
    }
  };
  self.editor.querySelector('input[name=remove-icon]').onclick = () => {
    const icon = self.editor.querySelector('fieldset[name=icons] input:checked');
    if (icon) {
      icon.checked = false;
    }
  };
  self.editor.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    e.submitter.disabled = true;
    e.submitter.value = 'Please wait...';

    try {
      const label = self.tbody.querySelector('label:has(input:checked)');

      current.entry.name = label.querySelector('span[name=name]').textContent =
        self.editor.querySelector('input[name=name]').value;
      current.entry.issuer = label.querySelector('span[name=issuer]').textContent =
        self.editor.querySelector('input[name=issuer]').value;
      current.entry.groups = [...self.editor.querySelector('select[name=groups]').selectedOptions].map(o => o.value);
      label.querySelector('span[name=groups]').textContent =
        current.entry.groups.map(uuid => groups.get(uuid)).join(', ');

      const icon = self.editor.querySelector('fieldset[name=icons] input[type=radio]:checked');
      if (icon) {
        current.entry['icon_hash'] = icon.value;
        const o = icons.get(icon.value);
        // icon is from default set and still have no data
        if ('path' in o) {
          o.icon = o.icon || await fetch(o.path).then(r => r.blob()).then(blob => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          }));
        }

        Object.assign(current.entry, o);
        label.querySelector('img[name=icon]').src = `data:${o['icon_mime']};base64,` + o.icon;
      }
      else {
        current.entry.icon = null;
        delete current.entry['icon_hash'];
        delete current.entry['icon_mime'];
        label.querySelector('img[name=icon]').src = '';
      }
      self.editor.querySelector('fieldset[name=icons]').textContent = ''; // cleaning

      // Fix groups
      for (const uuid of commands['remove-groups']) {
        groups.delete(uuid);
      }

      if (commands['remove-groups'].length) {
        for (const label of map.values()) {
          const {entry} = label.querySelector('input[type=radio]');
          if (entry.groups.some(uuid => groups.has(uuid) === false)) {
            entry.groups = entry.groups.filter(uuid => groups.has(uuid));
            label.querySelector('[name=groups]').textContent = entry.groups.join(', ');
          }
        }
      }

      // document.dispatchEvent(new Event('sort'));
      changed();
    }
    catch (e) {
      console.error(e);
      parent.command({
        cmd: 'notify',
        type: 'error',
        message: e.message
      });
    }
    e.submitter.value = 'Done';
    e.submitter.disabled = false;

    self.editor.close();
  };

  self.editor.showModal();
  const icon = self.editor.querySelector('fieldset[name=icons] input[type=radio]:checked');
  if (icon) {
    icon.scrollIntoViewIfNeeded();
  }
};
self.editor.querySelector('input[name=close]').onclick = () => self.editor.close();
self.editor.querySelector('input[name=has-groups]').onchange = e => {
  if (e.target.checked ) {
    if (self.editor.querySelector('select[name=groups]').selectedIndex === -1) {
      e.target.checked = false;
    }
  }
  else {
    self.editor.querySelector('select[name=groups]').selectedIndex = -1;
  }
};
self.editor.querySelector('select[name=groups]').onchange = e => {
  if (e.target.selectedIndex === -1) {
    self.editor.querySelector('input[name=has-groups]').checked = false;
    self.editor.querySelector('input[name=delete-groups]').disabled = true;
  }
  else {
    self.editor.querySelector('input[name=has-groups]').checked = true;
    self.editor.querySelector('input[name=delete-groups]').disabled = false;
  }
};
self.editor.querySelector('input[name=add-a-group]').onclick = async () => {
  const name = await prompt('Group Name:');
  if (name) {
    for (const n of groups.values()) {
      if (n === name) {
        return parent.command({
          cmd: 'notify',
          message: 'Group name already exists',
          type: 'error'
        });
      }
    }
    const uuid = crypto.randomUUID();
    groups.set(uuid, name);

    const option = document.createElement('option');
    option.value = uuid;
    option.textContent = name;
    option.selected = true;
    self.editor.querySelector('select[name=groups]').append(option);
    self.editor.querySelector('select[name=groups]').dispatchEvent(new Event('change'));
    option.scrollIntoViewIfNeeded();
  }
};
self.editor.querySelector('input[name=delete-groups]').onclick = e => {
  if (confirm('Selected groups will be deleted from all items. Are you sure?')) {
    for (const option of self.editor.querySelector('select[name=groups]').selectedOptions) {
      const uuid = option.value;
      commands['remove-groups'].push(uuid);
      option.remove();
    }
    self.editor.querySelector('select[name=groups]').dispatchEvent(new Event('change'));
  }
};
self.editor.querySelector('input[name=new-icon]').onchange = async e => {
  try {
    const file = e.target.files[0];
    const blob = await new Response(file).blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const base64 = btoa(String.fromCharCode(...bytes));

    const hash = await iconHashFromEntry({
      'icon': base64,
      'icon_mime': blob.type
    });

    if (icons.has(hash)) {
      self.editor.querySelector(`input[type=radio][value="${hash}"]`).click();
    }
    else {
      icons.set(hash, {
        'icon': base64,
        'icon_mime': blob.type
      });

      const clone = document.importNode(self.img.content, true);
      clone.querySelector('img').src = `data:${blob.mime};base64,` + base64;
      const radio = clone.querySelector('input[type=radio]');
      radio.value = hash;
      self.editor.querySelector('fieldset[name=icons]').append(clone.firstElementChild);
      radio.click();
    }
    e.value = '';
  }
  catch (e) {
    alert('Icon is too large?\n\n' + e.message);
  }
};

document.getElementById('sort-by-name').onclick = () => {
  if (sorting.name === 'name') {
    sorting.direction = -1 * sorting.direction;
  }
  else {
    sorting.direction = 1;
    sorting.name = 'name';
  }
  document.dispatchEvent(new Event('sort'));
};

document.getElementById('sort-by-issuer').onclick = () => {
  if (sorting.name === 'issuer') {
    sorting.direction = -1 * sorting.direction;
  }
  else {
    sorting.direction = 1;
    sorting.name = 'issuer';
  }
  document.dispatchEvent(new Event('sort'));
};

self.delete.onclick = () => {
  if (confirm('Are you sure you want to delete the selected OTP?') === false) {
    return;
  }

  const label = self.tbody.querySelector('label:has(input:checked)');
  const {entry} = label.querySelector('input[type=radio]');
  entry.deleted = true;
  const n = Number(label.getAttribute('order'));
  label.remove();
  map.delete(n);
  if (map.has(n - 1)) {
    map.get(n - 1).querySelector('input[type=radio]').checked = true;
    map.get(n - 1).querySelector('input[type=radio]').dispatchEvent(new Event('change', {bubbles: true}));
  }
  if (map.has(n + 1)) {
    map.get(n + 1).querySelector('input[type=radio]').checked = true;
    map.get(n + 1).querySelector('input[type=radio]').dispatchEvent(new Event('change', {bubbles: true}));
  }
  changed();
};

// add entry from otpauth:// URI (shared by text and QR code input)
const addFromURI = uri => {
  const url = new URL(uri);

  if (url.protocol !== 'otpauth:') {
    throw new Error('Invalid OTP URI');
  }

  // totp / hotp
  const type = url.host;
  if (type !== 'totp' && type !== 'hotp') {
    throw Error('Invalid OTP type');
  }

  // Label format:
  // otpauth://totp/Issuer:Account
  const rawLabel = decodeURIComponent(url.pathname.slice(1));

  let issuerFromLabel = '';
  let name = rawLabel;

  if (rawLabel.includes(':')) {
    const parts = rawLabel.split(':');
    issuerFromLabel = parts.shift().trim();
    name = parts.join(':').trim();
  }

  const params = url.searchParams;


  const issuer = params.get('issuer') || issuerFromLabel || null;

  const detail = {
    favorite: false,
    groups: [],
    icon: null,
    info: {
      secret: params.get('secret') || null,
      algo: (params.get('algorithm') || 'SHA1').toUpperCase(),
      digits: Number(params.get('digits') || 6)
    },
    issuer,
    name,
    note: '',
    type, // totp | hotp
    uuid: crypto.randomUUID(),
    selected: true
  };
  if (type === 'totp') {
    detail.info.period = Number(params.get('period') || 30);
  }
  else {
    detail.info.counter = params.has('counter') ? Number(params.get('counter')) : null;
  }

  document.dispatchEvent(new CustomEvent('entry', {
    detail
  }));
  changed();
};

self.new.onclick = async () => {
  try {
    const uri = await prompt('Enter URI');
    if (!uri) {
      return;
    }
    addFromURI(uri);
  }
  catch (e) {
    console.error(e);
    parent.command({
      cmd: 'notify',
      type: 'error',
      message: e.message
    });
  }
};

self.qr.onclick = async () => {
  try {
    if (typeof BarcodeDetector === 'undefined') {
      throw Error('QR code detection is not supported in this browser');
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    const file = await new Promise((resolve, reject) => {
      input.addEventListener('change', () => {
        if (!input.files?.length) {
          reject(new DOMException('The user aborted a request.', 'AbortError'));
          return;
        }
        resolve(input.files[0]);
      });
      input.click();
    });

    const bitmap = await createImageBitmap(file);
    const detector = new BarcodeDetector({
      formats: ['qr_code']
    });
    const results = await detector.detect(bitmap);

    if (!results.length) {
      throw Error('No QR code detected in the image');
    }

    addFromURI(results[0].rawValue);
  }
  catch (e) {
    if (e.name === 'AbortError') {
      return;
    }
    console.error(e);
    parent.command({
      cmd: 'notify',
      type: 'error',
      message: e.message
    });
  }
};
