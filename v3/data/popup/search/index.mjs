/* global otplib */

import {AegisVault} from '../aegis/core.mjs';
import Fuse from './fuse.min.mjs';

const groups = new Map();
const icons = new Map();
const map = new Map();

const current = {};

const sorting = {
  name: 'name',
  direction: 1,
  perform(entries) {
    entries.sort((a, b) => {
      return a[sorting.name].localeCompare(b[sorting.name]) * sorting.direction;
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

const start = entries => {
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
    map.set(n, label);
    self.tbody.append(label);
  }

  // search
  const fuse = new Fuse(entries, {
    keys: ['name', 'issuer', 'groups'],
    useTokenSearch: true
  });
  const reset = () => {
    for (const label of map.values()) {
      label.classList.remove('nomatch');
      self.tbody.appendChild(label); // re-order labels
    }
    map.get(0).querySelector('input[type=radio]').checked = true;
    map.get(0).querySelector('input[type=radio]').dispatchEvent(new Event('change', {bubbles: true}));
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

  map.get(0).click();
  self.search.focus();
};

onmessage = e => {
  const {database, keypath, password} = e.data;


  for (const group of database.groups) {
    groups.set(group.uuid, group.name);
  }

  sorting.perform(database.entries);
  start(database.entries);

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
        const blob = new Blob([json1], {type: 'application/json'});

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

      e.target.value = 'Encrypt...';
      const json2 = await vault.encrypt(password, database);

      e.target.value = 'Saving DB...';
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(json2, null, 2));
      await writable.close();

      e.target.value = 'Save';
      onbeforeunload = undefined;
    }
    catch (e) {
      console.error(e);
      parent.command({
        cmd: 'notify',
        type: 'error',
        message: e.message
      });
    }

    e.target.disabled = false;
  };

  // document.addEventListener('sort', () => sorting.perform(database.entries));
};

// keyboard support
onkeydown = e => {
  const meta = e.ctrlKey || e.metaKey;

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

    const now = (Date.now() / 1000);
    const timeIntoPeriod = now % entry.info.period;
    self.progress.style.setProperty('--period', entry.info.period + 's');
    self.progress.style.setProperty('--initial', -timeIntoPeriod + 's');
    self.progress.classList.remove('progress');
    void self.progress.offsetWidth; // reset
    self.progress.classList.add('progress');

    generate.run();
    self.copy.disabled = false;
    self.edit.disabled = false;
  }
};
generate.run = async () => {
  const {entry} = current;

  if (!entry) {
    return;
  }

  const token = generate.token = await otplib.generate({
    secret: entry.info.secret,
    strategy: entry.type, // "totp" or "hotp"

    // HOTP only (ignored for TOTP)
    counter: entry.type === 'hotp' ? entry.counter : undefined,

    // TOTP config
    period: entry.info.period,
    digits: entry.info.digits,
    algorithm: entry.info.algo.toLowerCase(), // "sha1"
    guardrails: otplib.createGuardrails({
      MIN_SECRET_BYTES: 10
    })
  });
  self.code.textContent = token.length === 6 ? (token.slice(0, 3) + ' ' + token.slice(3)) : token;
  if (entry.info.period) {
    // generate.timeout = setTimeout(generate.run, (remaining) * 1000);
  }
};
generate.stop = () => {
  self.progress.classList.remove('progress');
  self.copy.disabled = true;
  self.edit.disabled = true;
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
      e.target.value = 'Done';
    }
    catch (e) {
      console.error(e);
      e.target.value = 'Error';
    }

    id = setTimeout(() => {
      e.target.value = 'Copy';
    }, 750);
  };
}

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
    clone.querySelector('img').src = `data:${o['icon_mime']};base64,` + o.icon;
    const input = clone.querySelector('input[type=radio]');
    input.value = uuid;
    if (hash && hash === uuid) {
      input.checked = true;
    }
    self.editor.querySelector('fieldset[name=icons]').append(clone.firstElementChild);
  }

  self.editor.querySelector('input[name=remove-icon]').onclick = () => {
    const icon = self.editor.querySelector('.icons input:checked');
    if (icon) {
      icon.checked = false;
    }
  };
  self.editor.querySelector('form').onsubmit = e => {
    e.preventDefault();

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
      Object.assign(current.entry, o);
      label.querySelector('img[name=icon]').src = `data:${o['icon_mime']};base64,` + o.icon;
    }
    else {
      current.entry.icon = null;
      delete current.entry['icon_hash'];
      delete current.entry['icon_mime'];
      label.querySelector('img[name=icon]').src = '';
    }
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

    self.editor.close();

    document.dispatchEvent(new Event('sort'));
    self.save.disabled = false;
    onbeforeunload = e => {
      e.preventDefault();
      // required for Chrome
      return (e.returnValue = '');
    };
  };

  self.editor.showModal();
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
self.editor.querySelector('input[name=add-a-group]').onclick = () => {
  const name = prompt('Group Name:');
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
    const hash = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

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
