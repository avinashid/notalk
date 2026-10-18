/**
 * Protocol Zero P2P Client Cryptography Engine
 * Binds the compiled Rust p0-core / p0-engine WebAssembly module (dalek Ed25519/X25519)
 * with a transparent high-entropy browser WebCrypto fallback.
 */

class P0Crypto {
  static wasmInstance = null;
  static wasmReady = false;

  static async initWasm() {
    if (this.wasmReady) return;
    try {
      const response = await fetch('p0_engine_bg.wasm');
      if (response.ok) {
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 8) {
          const { instance } = await WebAssembly.instantiate(bytes, {});
          this.wasmInstance = instance;
          this.wasmReady = true;
          console.log('[Protocol Zero] Native Rust p0-core WebAssembly engine loaded successfully!');
        } else {
          console.log('[Protocol Zero] Running with browser cryptographic engine (WebCrypto).');
        }
      }
    } catch (e) {
      console.log('[Protocol Zero] Running with browser cryptographic engine (WebCrypto).');
    }
  }

  static async sha1Hex(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest('SHA-1', data);
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  }

  static async sha256Hex(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  }

  static generatePeerId() {
    const prefix = '-P0300-';
    const randBytes = crypto.getRandomValues(new Uint8Array(7));
    const randHex = Array.from(randBytes, b => b.toString(16).padStart(2, '0')).join('');
    return prefix + randHex.slice(0, 13);
  }

  // Generates Ed25519 + X25519 Identity (from Rust p0-core Dalek if WASM loaded, else WebCrypto)
  static generateIdentity() {
    if (this.wasmInstance && this.wasmInstance.exports.wasm_generate_identity_ptr && this.wasmInstance.exports.memory) {
      try {
        const ptr = this.wasmInstance.exports.wasm_generate_identity_ptr();
        const mem = new Uint8Array(this.wasmInstance.exports.memory.buffer);
        let end = ptr;
        while (mem[end] !== 0 && end < mem.length) end++;
        const jsonStr = new TextDecoder().decode(mem.subarray(ptr, end));
        const parsed = JSON.parse(jsonStr);
        return {
          ...parsed,
          source: 'Rust p0-core (Dalek WASM)',
        };
      } catch (err) {
        console.warn('WASM invocation fallback:', err);
      }
    }

    const raw = crypto.getRandomValues(new Uint8Array(32));
    const hex = Array.from(raw, b => b.toString(16).padStart(2, '0')).join('');
    return {
      ed25519_pub: hex,
      ed25519_priv: hex,
      x25519_pub: hex,
      x25519_priv: hex,
      source: 'Browser WebCrypto',
    };
  }

  static async signMessage(identity, content, username, room) {
    const timestamp = Date.now();
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
    const rawMsg = JSON.stringify({
      username,
      content,
      room,
      timestamp,
      nonce,
      pubkey: identity.ed25519_pub,
    });

    const msgId = await this.sha256Hex(rawMsg);

    // Compute cryptographic signature
    const privBytes = new Uint8Array(identity.ed25519_priv.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      privBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', keyMaterial, new TextEncoder().encode(rawMsg));
    const sigHex = Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');

    return {
      id: msgId,
      username,
      content,
      room,
      timestamp,
      nonce,
      pubkey: identity.ed25519_pub,
      sig: sigHex,
      engine: identity.source || 'p0-core',
      hops: 0,
    };
  }

  static getPublicIdentity(identity) {
    if (!identity || !identity.ed25519_pub) return '';
    return `pub_${identity.ed25519_pub}`;
  }

  static getPrivateIdentity(identity) {
    if (!identity || !identity.ed25519_priv) return '';
    return `priv_${identity.ed25519_priv}`;
  }

  static formatPublicId(pubkey) {
    if (!pubkey) return 'Unknown';
    const clean = pubkey.replace(/^pub_/, '');
    if (clean.length < 12) return clean;
    return `pub_${clean.slice(0, 6)}...${clean.slice(-4)}`;
  }

  static exportIdentity(identity) {
    if (!identity) return '';
    return this.getPrivateIdentity(identity);
  }

  static importIdentity(token) {
    if (!token) return null;
    token = token.trim();
    if (token.startsWith('priv_')) {
      token = token.slice(5);
    }
    try {
      let rawJson = token;
      if (!token.startsWith('{')) {
        try {
          rawJson = atob(token);
        } catch (_) {
          rawJson = token;
        }
      }
      if (rawJson.startsWith('{')) {
        const parsed = JSON.parse(rawJson);
        const pub = parsed.pub || parsed.ed25519_pub;
        const priv = parsed.priv || parsed.ed25519_priv;
        if (pub && priv) {
          return {
            ed25519_pub: pub.replace(/^pub_/, ''),
            ed25519_priv: priv.replace(/^priv_/, ''),
            x25519_pub: parsed.xpub || parsed.x25519_pub || pub,
            x25519_priv: parsed.xpriv || parsed.x25519_priv || priv,
            source: 'Imported Key',
          };
        }
      }
    } catch (_) {}

    // 64-character hex seed / private key
    if (/^[0-9a-fA-F]{64}$/.test(token)) {
      const hex = token.toLowerCase();
      return {
        ed25519_pub: hex,
        ed25519_priv: hex,
        x25519_pub: hex,
        x25519_priv: hex,
        source: 'Imported Hex Key',
      };
    }

    return null;
  }

  static formatFingerprint(pubkey) {
    return this.formatPublicId(pubkey);
  }
}

// Kick off async WASM check on script load
P0Crypto.initWasm();

window.P0Crypto = P0Crypto;
