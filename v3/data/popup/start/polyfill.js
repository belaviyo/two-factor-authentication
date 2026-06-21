if (!window.showOpenFilePicker) {
  window.showOpenFilePicker = async function(options = {}) {
    const input = document.createElement('input');
    input.type = 'file';

    // Convert picker accept types to input accept string
    if (options.types?.length) {
      const accepts = [];

      for (const type of options.types) {
        if (!type.accept) continue;

        for (const [mime, exts] of Object.entries(type.accept)) {
          accepts.push(mime);
          accepts.push(...exts);
        }
      }

      input.accept = accepts.join(',');
    }

    if (options.multiple) {
      input.multiple = true;
    }

    const files = await new Promise((resolve, reject) => {
      input.addEventListener('change', () => {
        if (!input.files?.length) {
          reject(new DOMException('The user aborted a request.', 'AbortError'));
          return;
        }

        resolve([...input.files]);
      });

      input.click();
    });

    return files.map(file => ({
      kind: 'file',
      name: file.name,

      async getFile() {
        return file;
      },

      async isSameEntry(other) {
        return other === this;
      },

      // Read-only fallback
      async createWritable() {
        throw new Error(
          'createWritable() is not supported by this Firefox polyfill. ' +
          'Use IndexedDB or download the modified file.'
        );
      }
    }));
  };
}
