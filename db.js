/**
 * Protocol Zero - IndexedDB Message Storage & Auto-Retention Manager
 * Supports: 1 Hour, 24 Hours, 7 Days, or Session-Only retention.
 */

class ChatStorage {
  constructor() {
    this.dbName = 'P0GlobalChatDB';
    this.dbVersion = 1;
    this.db = null;
    this.retention = localStorage.getItem('p0_chat_retention') || '24h'; // 'none', '1h', '24h', '7d'
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('messages')) {
          const store = db.createObjectStore('messages', { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('pinned', 'pinned', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        this.purgeExpired();
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.warn('IndexedDB unavailable, falling back to memory only:', e);
        resolve(null);
      };
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
    localStorage.setItem('p0_chat_retention', val);
    if (val === 'none') {
      this.clearAll();
    } else {
      this.purgeExpired();
    }
  }

  async saveMessage(msg) {
    if (!this.db || this.retention === 'none') return;
    try {
      const tx = this.db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      const record = {
        id: msg.id,
        username: msg.username,
        pubkey: msg.pubkey || '',
        content: msg.content,
        timestamp: msg.timestamp || Date.now(),
        pinned: !!msg.pinned,
        isMe: !!msg.isMe
      };
      store.put(record);
    } catch (e) {
      console.warn('Failed to save message to IndexedDB:', e);
    }
  }

  async loadRecentMessages() {
    if (!this.db || this.retention === 'none') return [];
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('messages', 'readonly');
        const store = tx.objectStore('messages');
        const index = store.index('timestamp');
        const cutoff = Date.now() - this.getRetentionMs();

        const request = index.getAll();
        request.onsuccess = () => {
          const all = request.result || [];
          const valid = all.filter(m => m.timestamp >= cutoff || m.pinned);
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
    } catch (e) {
      console.warn('Failed to toggle pin in IndexedDB:', e);
    }
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
          // Purge if expired and not pinned
          if (val.timestamp < cutoff && !val.pinned) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
    } catch (_) {}
  }

  async clearAll() {
    if (!this.db) return;
    try {
      const tx = this.db.transaction('messages', 'readwrite');
      tx.objectStore('messages').clear();
    } catch (_) {}
  }
}

window.chatStorage = new ChatStorage();

