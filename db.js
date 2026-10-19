/**
 * High-Throughput IndexedDB Storage & Multi-Conversation Manager (v4.0)
 * - Coalesces message writes into 200ms batch transactions
 * - Persists rich media attachments (images, videos, audio, voice notes, files) & message reactions
 * - Supports Session-Only, 1h, 24h, and 7d automatic retention
 */

class ChatStorage {
  constructor() {
    this.dbName = 'NoTalkMessengerDB_v4';
    this.dbVersion = 1;
    this.db = null;
    this.retention = this.safeGetStorage('p0_chat_retention') || '24h';
    this.writeQueue = new Map();
    this.flushTimer = null;
  }

  safeGetStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  safeSetStorage(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch (_) {}
  }

  async init() {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(this.dbName, this.dbVersion);

        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('messages')) {
            const store = db.createObjectStore('messages', { keyPath: 'id' });
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('convId', 'convId', { unique: false });
            store.createIndex('pinned', 'pinned', { unique: false });
          }
          if (!db.objectStoreNames.contains('conversations')) {
            db.createObjectStore('conversations', { keyPath: 'id' });
          }
        };

        request.onsuccess = (e) => {
          this.db = e.target.result;
          this.purgeExpired();
          resolve(this.db);
        };

        request.onerror = () => {
          resolve(null);
        };
      } catch (_) {
        resolve(null);
      }
    });
  }

  getRetentionMs() {
    switch (this.retention) {
      case '1h': return 60 * 60 * 1000;
      case '24h': return 24 * 60 * 60 * 1000;
      case '7d': return 7 * 24 * 60 * 60 * 1000;
      case 'none': return 0;
      default: return 24 * 60 * 60 * 1000;
    }
  }

  setRetention(val) {
    this.retention = val;
    this.safeSetStorage('p0_chat_retention', val);
    if (val === 'none') {
      this.clearAllMessages();
    } else {
      this.purgeExpired();
    }
  }

  saveMessage(msg) {
    if (!this.db || this.retention === 'none' || !msg || !msg.id) return;
    const record = {
      id: msg.id,
      convId: msg.convId || msg.room || 'global',
      username: msg.username || 'anon',
      pubkey: msg.pubkey || '',
      content: msg.content || '',
      timestamp: msg.timestamp || Date.now(),
      pinned: !!msg.pinned,
      replyTo: msg.replyTo || null,
      inviteData: msg.inviteData || null,
      attachments: Array.isArray(msg.attachments) ? msg.attachments : null,
      reactions: msg.reactions || null,
      encrypted: !!msg.encrypted,
    };
    this.writeQueue.set(record.id, record);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushWrites(), 200);
    }
  }

  flushWrites() {
    this.flushTimer = null;
    if (!this.db || this.writeQueue.size === 0) return;
    const batch = Array.from(this.writeQueue.values());
    this.writeQueue.clear();
    try {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      for (let i = 0; i < batch.length; i++) {
        store.put(batch[i]);
      }
    } catch (_) {}
  }

  async saveConversation(conv) {
    if (!this.db || !conv || !conv.id) return;
    try {
      const tx = this.db.transaction('conversations', 'readwrite');
      tx.objectStore('conversations').put(conv);
    } catch (_) {}
  }

  async deleteConversation(convId) {
    if (!this.db || !convId) return;
    try {
      const tx = this.db.transaction('conversations', 'readwrite');
      tx.objectStore('conversations').delete(convId);
    } catch (_) {}
  }

  async loadConversations() {
    if (!this.db) return [];
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('conversations', 'readonly');
        const req = tx.objectStore('conversations').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (_) {
        resolve([]);
      }
    });
  }

  async loadRecentMessages() {
    if (!this.db || this.retention === 'none') return [];
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('messages', 'readonly');
        const store = tx.objectStore('messages');
        const cutoff = Date.now() - this.getRetentionMs();
        const request = store.getAll();
        request.onsuccess = () => {
          const all = request.result || [];
          const valid = all
            .filter(m => m.timestamp >= cutoff || m.pinned)
            .sort((a, b) => a.timestamp - b.timestamp);
          resolve(valid);
        };
        request.onerror = () => resolve([]);
      } catch (_) {
        resolve([]);
      }
    });
  }

  async togglePin(msgId, isPinned) {
    if (!this.db) return;
    try {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      const getReq = store.get(msgId);
      getReq.onsuccess = () => {
        const msg = getReq.result;
        if (msg) {
          msg.pinned = isPinned;
          store.put(msg);
        }
      };
    } catch (_) {}
  }

  async loadPinnedMessages() {
    if (!this.db) return [];
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('messages', 'readonly');
        const store = tx.objectStore('messages');
        const request = store.getAll();
        request.onsuccess = () => {
          const all = request.result || [];
          resolve(all.filter(m => m.pinned));
        };
        request.onerror = () => resolve([]);
      } catch (_) {
        resolve([]);
      }
    });
  }

  async purgeExpired() {
    if (!this.db || this.retention === 'none') return;
    try {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      const cutoff = Date.now() - this.getRetentionMs();
      const request = store.openCursor();
      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const val = cursor.value;
          if (val.timestamp < cutoff && !val.pinned) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
    } catch (_) {}
  }

  async clearAllMessages() {
    this.writeQueue.clear();
    if (!this.db) return;
    try {
      const tx = this.db.transaction('messages', 'readwrite');
      tx.objectStore('messages').clear();
    } catch (_) {}
  }

  async clearAll() {
    return this.clearAllMessages();
  }
}

window.chatStorage = new ChatStorage();
