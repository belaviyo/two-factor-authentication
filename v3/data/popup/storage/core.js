/* global FileSystemFileHandle */

if (typeof FileSystemFileHandle !== 'undefined') {
  FileSystemFileHandle.prototype.isSameEntry = new Proxy(FileSystemFileHandle.prototype.isSameEntry, {
    apply(target, self, args) {
      if (self.kind === 'remote' && args[0].kind !== 'remote') {
        return false;
      }
      if (self.kind !== 'remote' && args[0].kind === 'remote') {
        return false;
      }
      if (self.kind === 'remote' && args[0].kind === 'remote') {
        return self.href === args[0].href;
      }
      return Reflect.apply(target, self, args);
    }
  });
}

const MAX_REMOTE_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB

// Strip credentials/tokens (query, fragment, userinfo) before persisting
// a remote URL, so signed URLs are not leaked via chrome.storage.local
// or the IndexedDB handle store. The live in-memory handle keeps the
// original URL for the current session.
function sanitizeRemoteHref(href) {
  try {
    const u = new URL(href);
    u.search = '';
    u.hash = '';
    u.username = '';
    u.password = '';
    return u.toString();
  }
  catch {
    return href;
  }
}

// Match the File System Access API contract: mode defaults to 'read'
// and must be 'read' or 'readwrite'. Chrome host permissions have no
// read/readwrite granularity, so mode is validated for compatibility
// but does not affect the underlying chrome.permissions call; a
// readwrite failure is surfaced by the server rejecting the POST.
function checkPermissionMode({mode = 'read'} = {}) {
  if (!['read', 'readwrite'].includes(mode)) {
    throw new TypeError(`Invalid permission mode: ${mode}`);
  }
  return mode;
}

class Storage {
  #DB_NAME = 'file-storage';
  #db;

  static remote(o) {
    o.name = o.href;

    if (typeof FileSystemFileHandle !== 'undefined') {
      o.isSameEntry = FileSystemFileHandle.prototype.isSameEntry.bind(o);
    }
    else {
      o.isSameEntry = function(other) {
        return self.href === other.href;
      };
    }

    o.getFile = async () => {
      const res = await fetch(o.href);

      if (!res.ok) {
        throw Error('Failed to fetch remote vault: ' + res.status + ' ' + res.statusText);
      }

      const length = Number(res.headers.get('content-length'));
      if (Number.isFinite(length) && length > MAX_REMOTE_FILE_SIZE) {
        throw Error('Remote vault is too large: ' + length + ' bytes');
      }

      const blob = await res.blob();

      if (blob.size > MAX_REMOTE_FILE_SIZE) {
        throw Error('Remote vault is too large: ' + blob.size + ' bytes');
      }

      // Do not rely on blob.type: many servers serve JSON as
      // text/plain, application/octet-stream, or with no type.
      // Callers parse with Response.json(), which rejects non-JSON.
      return new File([blob], o.name, {type: blob.type});
    };

    o.createWritable = async () => {
      const res = await fetch(o.href);

      if (!res.ok) {
        throw Error('Failed to fetch remote vault: ' + res.status + ' ' + res.statusText);
      }

      let buffer = await res.blob();

      return {
        write(data) {
          if (typeof data === 'string') {
            buffer = new Blob([data]);
          }
          else {
            throw Error('only string is supported for remote source');
          }
        },
        close: () => {
          return fetch(o.href, {
            method: 'POST',
            body: buffer
          }).then(r => {
            if (!r.ok) {
              throw Error('cannot write on server; ' + r.statusText + '[' + r.status + ']');
            }
          });
        }
      };
    };
    // Side-effect-free check, matching FileSystemHandle.queryPermission.
    // chrome.permissions.contains() cannot distinguish "never asked"
    // from "denied", so a missing grant is reported as 'prompt' to
    // trigger the caller's requestPermission() fallback.
    o.queryPermission = async (options = {}) => {
      checkPermissionMode(options);
      return (await chrome.permissions.contains({
        origins: [o.href]
      })) ? 'granted' : 'prompt';
    };
    // Prompting counterpart, matching FileSystemHandle.requestPermission.
    o.requestPermission = async (options = {}) => {
      checkPermissionMode(options);
      return (await chrome.permissions.request({
        origins: [o.href]
      })) ? 'granted' : 'denied';
    };
    return o;
  }

  constructor(name = 'file') {
    this.#DB_NAME = name;
  }
  open(storages = []) { // [{name: 'handles', options: {autoIncrement: true}}]
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.#DB_NAME, 1);

      request.onupgradeneeded = () => {
        const db = request.result;

        for (const storage of storages) {
          if (db.objectStoreNames.contains(storage.name) === false) {
            db.createObjectStore(storage.name, storage.options || {
              autoIncrement: true
            });
          }
        }
      };

      request.onsuccess = () => {
        this.#db = request.result;
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }
  close() {
    this.#db.close();
  }
  put(storage, value) {
    if (value.kind === 'remote') {
      value = {
        kind: 'remote',
        href: sanitizeRemoteHref(value.href)
      };
    }

    return new Promise((resolve, reject) => {
      const transaction = this.#db.transaction(storage, 'readwrite');

      // Store the file with its data
      const fileStore = transaction.objectStore(storage);
      const request = fileStore.add(value);
      // force an early commit
      transaction.commit?.();

      request.onsuccess = () => {};
      // resolve only when the data is durably committed
      transaction.oncomplete = () => resolve(request.result);

      request.onerror = e => reject(Error(e.target.error));
      transaction.onerror = e => reject(Error(e.target.error));
    });
  }
  read(storage, keypath) {
    return new Promise((resolve, reject) => {
      const transaction = this.#db.transaction(storage, 'readonly');
      const store = transaction.objectStore(storage);

      const request = store.get(keypath);

      request.onsuccess = () => {
        if (request.result.kind === 'remote') {
          resolve({
            keypath,
            value: Storage.remote(request.result)
          });
        }
        else {
          resolve({
            keypath,
            value: request.result
          });
        }
      };
      request.onerror = e => reject(Error('getHandle, ' + e.target.error));
    });
  }
  remove(storage, keypath) {
    return new Promise((resolve, reject) => {
      const transaction = this.#db.transaction(storage, 'readwrite');
      const store = transaction.objectStore(storage);

      const request = store.delete(keypath);
      // force an early commit
      transaction.commit?.();

      // resolve only when the data is durably committed
      transaction.oncomplete = () => resolve();

      request.onerror = e => reject(Error(e.target.error));
      transaction.onerror = e => reject(Error(e.target.error));
    });
  }
  list(storage) {
    return new Promise((resolve, reject) => {
      const transaction = this.#db.transaction(storage, 'readonly');

      const values = [];
      transaction.objectStore(storage).openCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) {
          if (cursor.value.kind === 'remote') {
            values.push({
              keypath: cursor.key,
              value: Storage.remote(cursor.value)
            });
          }
          else {
            values.push({
              keypath: cursor.key,
              value: cursor.value
            });
          }
          cursor.continue();
        }
      };
      transaction.onerror = e => reject(Error(e.target.error));
      transaction.oncomplete = () => resolve(values);
    });
  }
}
