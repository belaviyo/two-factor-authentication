/* global hashwasm */

export function bytesToBase64(bytes) {
  const chunkSize = 8192;
  let bin = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunkSize)
    );
  }
  return btoa(bin);
}

export class InvalidVaultError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidVaultError';
    this.code = 'invalid-vault';
  }
}

export class VaultUnlockError extends Error {
  constructor(message = 'Wrong password or corrupted vault') {
    super(message);
    this.name = 'VaultUnlockError';
    this.code = 'wrong-password-or-corrupted';
  }
}

export class AegisVault {
  constructor(vaultJson) {
    try {
      this.vault =
        typeof vaultJson === 'string' ? JSON.parse(vaultJson) : vaultJson;
    }
    catch (e) {
      throw new InvalidVaultError(`Vault is not valid JSON: ${e.message}`);
    }
    this.#validateVault();
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
      groups: []
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
      db: bytesToBase64(encryptedDb)
    };

    return new AegisVault(vault);
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  async decrypt(password) {
    const {masterKey} = await this.#unlockMasterKey(password);

    const dbBytes = await this.#aesDecrypt({
      key: masterKey,
      nonce: this.#hexToBytes(this.vault.header.params.nonce),
      tag: this.#hexToBytes(this.vault.header.params.tag),
      data: this.#base64ToBytes(this.vault.db)
    });

    return JSON.parse(new TextDecoder().decode(dbBytes));
  }

  async encrypt(password, databaseObject) {
    const {masterKey} = await this.#unlockMasterKey(password);

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

  async changePassword(oldPassword, newPassword) {
    const {masterKey, slot} = await this.#unlockMasterKey(oldPassword);

    const salt = crypto.getRandomValues(new Uint8Array(32));

    const newDerivedKey = await this.#deriveKey(newPassword, salt);

    const encrypted = await this.#aesEncrypt({
      key: newDerivedKey,
      data: masterKey
    });

    slot.salt = this.#bytesToHex(salt);
    slot.key = this.#bytesToHex(encrypted.ciphertext);
    slot.key_params = {
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

    let result;
    try {
      result = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: nonce,
          tagLength: 128
        },
        cryptoKey,
        combined
      );
    }
    catch (e) {
      // GCM cannot distinguish a wrong key from corrupted data
      if (e?.name === 'OperationError') {
        throw new VaultUnlockError('Wrong password or corrupted vault');
      }
      throw e;
    }

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

  #getPasswordSlots() {
    return this.vault.header.slots.filter(
      s => s.type === 1
    );
  }

  // Try every password slot in order. All slots wrap the same master
  // key, so any slot that decrypts successfully is sufficient.
  async #unlockMasterKey(password) {
    for (const slot of this.#getPasswordSlots()) {
      const derivedKey = await this.#deriveKey(
        password,
        this.#hexToBytes(slot.salt)
      );

      try {
        const masterKey = await this.#aesDecrypt({
          key: derivedKey,
          nonce: this.#hexToBytes(slot.key_params.nonce),
          tag: this.#hexToBytes(slot.key_params.tag),
          data: this.#hexToBytes(slot.key)
        });

        return {masterKey, slot};
      }
      catch (e) {
        if (e instanceof VaultUnlockError) {
          continue;
        }
        throw e;
      }
    }

    throw new VaultUnlockError('Wrong password or corrupted vault');
  }

  #assertHex(label, value, length) {
    if (
      typeof value !== 'string' ||
      value.length !== length ||
      !/^[0-9a-fA-F]+$/.test(value)
    ) {
      throw new InvalidVaultError(
        `Invalid vault: ${label} must be ${length} hex characters`
      );
    }
  }

  #validateVault() {
    const vault = this.vault;

    if (!vault || typeof vault !== 'object') {
      throw new InvalidVaultError('Invalid vault: expected an object');
    }

    if (vault.version !== 1) {
      throw new InvalidVaultError(
        `Unsupported vault version: ${vault.version}`
      );
    }

    const header = vault.header;
    if (!header || typeof header !== 'object') {
      throw new InvalidVaultError('Invalid vault: missing header');
    }

    if (!Array.isArray(header.slots) || header.slots.length === 0) {
      throw new InvalidVaultError('Invalid vault: missing header.slots');
    }

    const params = header.params;
    if (!params || typeof params !== 'object') {
      throw new InvalidVaultError('Invalid vault: missing header.params');
    }
    this.#assertHex('header.params.nonce', params.nonce, 24);
    this.#assertHex('header.params.tag', params.tag, 32);

    for (const slot of header.slots) {
      if (!slot || typeof slot !== 'object') {
        throw new InvalidVaultError('Invalid vault: malformed slot');
      }
      // only password slots are tried; other slot types have a
      // different shape and are ignored
      if (slot.type !== 1) {
        continue;
      }
      this.#assertHex('slot.salt', slot.salt, 64);
      this.#assertHex('slot.key', slot.key, 64);
      const keyParams = slot.key_params;
      if (!keyParams || typeof keyParams !== 'object') {
        throw new InvalidVaultError('Invalid vault: missing slot.key_params');
      }
      this.#assertHex('slot.key_params.nonce', keyParams.nonce, 24);
      this.#assertHex('slot.key_params.tag', keyParams.tag, 32);
    }

    if (this.#getPasswordSlots().length === 0) {
      throw new InvalidVaultError('No password slot found');
    }

    if (
      typeof vault.db !== 'string' ||
      vault.db.length === 0 ||
      vault.db.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(vault.db)
    ) {
      throw new InvalidVaultError('Invalid vault: db is not valid base64');
    }
    try {
      // confirm it actually decodes before attempting crypto
      this.#base64ToBytes(vault.db);
    }
    catch {
      throw new InvalidVaultError('Invalid vault: db is not valid base64');
    }
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
    return bytesToBase64(bytes);
  }
}
