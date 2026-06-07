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


class Storage {
  #DB_NAME = 'file-storage';
  #db;

  static remote(o) {
    o.name = o.href;

    o.isSameEntry = FileSystemFileHandle.prototype.isSameEntry.bind(o);

    o.getFile = async () => {
      const res = await fetch(o.href);
      const blob = await res.blob();

      if (blob.type.includes('/json') === false) {
        throw Error('Remote is not JSON');
      }

      return new File([blob], this.name, {type: blob.type});
    };

    o.createWritable = async () => {
      let buffer = await (await fetch(o.href)).blob();

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
    o.queryPermission = () => chrome.permissions.request({
      origins: [o.href]
    }).then(b => b ? 'granted' : 'denied');
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
        href: value.href
      };
    }

    return new Promise((resolve, reject) => {
      const transaction = this.#db.transaction(storage, 'readwrite');

      // Store the file with its data
      const fileStore = transaction.objectStore(storage);
      const request = fileStore.add(value);

      request.onsuccess = () => resolve(request.result);

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

      request.onsuccess = () => resolve();
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
