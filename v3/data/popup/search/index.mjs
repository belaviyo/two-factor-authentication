/* global otplib */
import Fuse from './fuse.min.mjs';

const groups = new Map();
const map = new Map();

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

  for (let n = 0; n < entries.length; n += 1) {
    const entry = entries[n];

    const clone = document.importNode(self.entry.content, true);
    const name = clone.querySelector('[name=name]');
    name.title = name.textContent = entry.name;

    const issuer = clone.querySelector('[name=issuer]');
    issuer.title = issuer.textContent = entry.issuer;

    if (entry.icon) {
      clone.querySelector('[name=icon]').src = `data:${entry['icon_mime']};base64,` + entry.icon;
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
  const {database} = e.data;

  for (const group of database.groups) {
    groups.set(group.uuid, group.name);
  }

  sorting.perform(database.entries);
  start(database.entries);
  document.getElementById('sort-by-name').onclick = () => {
    if (sorting.name === 'name') {
      sorting.direction = -1 * sorting.direction;
    }
    else {
      sorting.direction = 1;
      sorting.name = 'name';
    }
    sorting.perform(database.entries);
  };
  document.getElementById('sort-by-issuer').onclick = () => {
    if (sorting.name === 'issuer') {
      sorting.direction = -1 * sorting.direction;
    }
    else {
      sorting.direction = 1;
      sorting.name = 'issuer';
    }
    sorting.perform(database.entries);
  };
};

// keyboard support
onkeydown = e => {
  if ((e.key.toLowerCase() === 'f' && (e.ctrlKey || e.metaKey))) {
    e.preventDefault();
    self.search.focus();

    return;
  }
  if ((e.key.toLowerCase() === 'c' && (e.ctrlKey || e.metaKey)) || e.key === 'Enter') {
    e.preventDefault();
    self.copy.click();

    return;
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
  if (generate.entry !== entry) {
    generate.entry = entry;

    const now = (Date.now() / 1000);
    const timeIntoPeriod = now % entry.info.period;
    self.progress.style.setProperty('--period', entry.info.period + 's');
    self.progress.style.setProperty('--initial', -timeIntoPeriod + 's');
    self.progress.classList.remove('progress');
    void self.progress.offsetWidth; // reset
    self.progress.classList.add('progress');

    generate.run();
    self.copy.disabled = false;
  }
};
generate.run = async () => {
  const {entry} = generate;

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
  delete generate.entry;
};
document.onchange = e => {
  const {entry} = e.target;
  if (entry) {
    generate(entry);
  }
  else if (!generate.entry) {
    generate.stop();
    self.code.textContent = 'Select an item to show OTP';
  }
};
self.progress.addEventListener('animationend', () => {
  if (generate.entry) {
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
