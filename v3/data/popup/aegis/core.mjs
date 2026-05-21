/* global hashwasm */

export class AegisVault {
  constructor(vaultJson) {
    this.vault =
      typeof vaultJson === 'string' ? JSON.parse(vaultJson) : vaultJson;
  }

  static async create(password) {
    // --------------------------------------------------
    // Generate salt + master key
    // --------------------------------------------------

    const salt = crypto.getRandomValues(
      new Uint8Array(32)
    );

    const masterKey = crypto.getRandomValues(
      new Uint8Array(32)
    );

    // --------------------------------------------------
    // Derive password key
    // --------------------------------------------------

    const derivedKey = await hashwasm.scrypt({
      password,
      salt,
      costFactor: 32768,
      blockSize: 8,
      parallelism: 1,
      hashLength: 32,
      outputType: 'binary'
    });

    // --------------------------------------------------
    // Encrypt master key
    // --------------------------------------------------

    const keyNonce = crypto.getRandomValues(
      new Uint8Array(12)
    );

    const keyCryptoKey =
      await crypto.subtle.importKey(
        'raw',
        derivedKey,
        'AES-GCM',
        false,
        ['encrypt']
      );

    const encryptedMasterFull =
      new Uint8Array(
        await crypto.subtle.encrypt(
          {
            name: 'AES-GCM',
            iv: keyNonce,
            tagLength: 128
          },
          keyCryptoKey,
          masterKey
        )
      );

    const keyTag = encryptedMasterFull.slice(-16);

    const encryptedMasterKey =
      encryptedMasterFull.slice(
        0,
        encryptedMasterFull.length - 16
      );

    // --------------------------------------------------
    // Empty database
    // --------------------------------------------------

    const emptyDb = {
      version: 1,
      entries: [],
      groups: [],
      icons_optimized: true
    };

    const dbBytes = new TextEncoder().encode(
      JSON.stringify(emptyDb)
    );

    // --------------------------------------------------
    // Encrypt database
    // --------------------------------------------------

    const dbNonce = crypto.getRandomValues(
      new Uint8Array(12)
    );

    const dbCryptoKey =
      await crypto.subtle.importKey(
        'raw',
        masterKey,
        'AES-GCM',
        false,
        ['encrypt']
      );

    const encryptedDbFull =
      new Uint8Array(
        await crypto.subtle.encrypt(
          {
            name: 'AES-GCM',
            iv: dbNonce,
            tagLength: 128
          },
          dbCryptoKey,
          dbBytes
        )
      );

    const dbTag = encryptedDbFull.slice(-16);

    const encryptedDb =
      encryptedDbFull.slice(
        0,
        encryptedDbFull.length - 16
      );

    // --------------------------------------------------
    // Build Aegis vault
    // --------------------------------------------------

    const vault = {
      version: 1,
      header: {
        slots: [
          {
            type: 1,
            salt: Array.from(salt)
              .map(b =>
                b.toString(16).padStart(2, '0')
              )
              .join(''),
            key: Array.from(encryptedMasterKey)
              .map(b =>
                b.toString(16).padStart(2, '0')
              )
              .join(''),
            key_params: {
              nonce: Array.from(keyNonce)
                .map(b =>
                  b.toString(16).padStart(2, '0')
                )
                .join(''),
              tag: Array.from(keyTag)
                .map(b =>
                  b.toString(16).padStart(2, '0')
                )
                .join('')
            }
          }
        ],
        params: {
          nonce: Array.from(dbNonce)
            .map(b =>
              b.toString(16).padStart(2, '0')
            )
            .join(''),
          tag: Array.from(dbTag)
            .map(b =>
              b.toString(16).padStart(2, '0')
            )
            .join('')
        }
      },
      db: btoa(
        String.fromCharCode(...encryptedDb)
      )
    };

    return new AegisVault(vault);
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  async decrypt(password) {
    const slot = this.#getPasswordSlot();

    const derivedKey = await this.#deriveKey(
      password,
      this.#hexToBytes(slot.salt)
    );

    const masterKey = await this.#aesDecrypt({
      key: derivedKey,
      nonce: this.#hexToBytes(slot.key_params.nonce),
      tag: this.#hexToBytes(slot.key_params.tag),
      data: this.#hexToBytes(slot.key)
    });

    const dbBytes = await this.#aesDecrypt({
      key: masterKey,
      nonce: this.#hexToBytes(this.vault.header.params.nonce),
      tag: this.#hexToBytes(this.vault.header.params.tag),
      data: this.#base64ToBytes(this.vault.db)
    });

    return JSON.parse(new TextDecoder().decode(dbBytes));
  }

  async encrypt(password, databaseObject) {
    const slot = this.#getPasswordSlot();

    const derivedKey = await this.#deriveKey(
      password,
      this.#hexToBytes(slot.salt)
    );

    const masterKey = await this.#aesDecrypt({
      key: derivedKey,
      nonce: this.#hexToBytes(slot.key_params.nonce),
      tag: this.#hexToBytes(slot.key_params.tag),
      data: this.#hexToBytes(slot.key)
    });

    const plain = new TextEncoder().encode(
      JSON.stringify(databaseObject)
    );

    const encrypted = await this.#aesEncrypt({
      key: masterKey,
      data: plain
    });

    this.vault.db = this.#bytesToBase64(encrypted.ciphertext);

    this.vault.header.params = {
      nonce: this.#bytesToHex(encrypted.nonce),
      tag: this.#bytesToHex(encrypted.tag)
    };

    return this.vault;
  }

  // =====================================================
  // PRIVATE METHODS
  // =====================================================

  async #deriveKey(password, salt) {
    if (!hashwasm?.scrypt) {
      throw new Error('hashwasm.scrypt not loaded');
    }

    return await hashwasm.scrypt({
      password,
      salt,
      costFactor: 32768,
      blockSize: 8,
      parallelism: 1,
      hashLength: 32,
      outputType: 'binary'
    });
  }

  async #aesDecrypt({key, nonce, tag, data}) {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      'AES-GCM',
      false,
      ['decrypt']
    );

    const combined = new Uint8Array(
      data.length + tag.length
    );

    combined.set(data, 0);
    combined.set(tag, data.length);

    const result = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        tagLength: 128
      },
      cryptoKey,
      combined
    );

    return new Uint8Array(result);
  }

  async #aesEncrypt({key, data}) {
    const nonce = crypto.getRandomValues(
      new Uint8Array(12)
    );

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      'AES-GCM',
      false,
      ['encrypt']
    );

    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        tagLength: 128
      },
      cryptoKey,
      data
    );

    const full = new Uint8Array(encrypted);

    const tag = full.slice(full.length - 16);
    const ciphertext = full.slice(
      0,
      full.length - 16
    );

    return {nonce, ciphertext, tag};
  }

  #getPasswordSlot() {
    const slot = this.vault.header.slots.find(
      s => s.type === 1
    );

    if (!slot) {
      throw new Error('No password slot found');
    }

    return slot;
  }

  #hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);

    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.substr(i * 2, 2), 16);
    }

    return out;
  }

  #base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);

    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }

    return out;
  }

  #bytesToHex(bytes) {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  #bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
  }
}
