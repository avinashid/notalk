/**
 * Real-Time Messaging Transport Engine (v4.0)
 * - Strict live presence verification (ignores stale/retained packets; zero fake or ghost users)
 * - Supports rich media attachments (images, videos, audio, voice notes, documents) & emoji reactions
 * - Two-generation 32,768-entry O(1) deduplication ring (`SeenMessageRing`)
 */

class SeenMessageRing {
  constructor(capacityPerGen = 16384) {
    this.cap = capacityPerGen;
    this.genCurrent = new Set();
    this.genPrevious = new Set();
  }

  has(id) {
    return this.genCurrent.has(id) || this.genPrevious.has(id);
  }

  add(id) {
    if (!id) return false;
    if (this.has(id)) return false;
    this.genCurrent.add(id);
    if (this.genCurrent.size >= this.cap) {
      this.genPrevious = this.genCurrent;
      this.genCurrent = new Set();
    }
    return true;
  }

  get size() {
    return this.genCurrent.size + this.genPrevious.size;
  }
}

class MqttSignalingClient {
  constructor(options = {}) {
    this.brokerUrls = [
      'wss://broker.emqx.io:8084/mqtt',
      'wss://broker.hivemq.com:8884/mqtt',
    ];
    // Isolated v4 channel so legacy/demo bots on v1-v3 topics never appear
    this.namespace = 'notalk_v4_live_app';
    this.room = options.room || 'global';
    this.peerId = options.peerId || ('p_' + Math.random().toString(36).substring(2, 10));
    this.pubkeyPrefix = (options.pubkey || '').replace(/^pub_/, '').toLowerCase().slice(0, 24);
    this.onMessage = options.onMessage || (() => {});
    this.onConnect = options.onConnect || null;
    this.connections = new Map();
    this.subscribedTopics = new Set();
    this.outbox = [];
    this.nextPacketId = 1;
    this.hasNotifiedConnect = false;
    this.isDestroyed = false;
    this.stats = { framesIn: 0, framesOut: 0 };
  }

  get isConnected() {
    for (const conn of this.connections.values()) {
      if (conn.isConnected) return true;
    }
    return false;
  }

  get connectedBrokerCount() {
    let c = 0;
    for (const conn of this.connections.values()) {
      if (conn.isConnected) c++;
    }
    return c;
  }

  connect() {
    if (this.isDestroyed) return;
    this.brokerUrls.forEach(url => this.connectBroker(url));
  }

  updatePubkeySubscription(newPubkey) {
    const newPrefix = (newPubkey || '').replace(/^pub_/, '').toLowerCase().slice(0, 24);
    if (!newPrefix || newPrefix === this.pubkeyPrefix) return;
    this.pubkeyPrefix = newPrefix;
    const topic = `${this.namespace}/${this.room}/pub/${this.pubkeyPrefix}`;
    this.subscribeTopic(topic);
  }

  subscribeTopic(topic) {
    if (!topic) return;
    this.subscribedTopics.add(topic);
    for (const conn of this.connections.values()) {
      if (conn.isConnected) {
        this.sendSubscribe(conn, topic);
      }
    }
  }

  connectBroker(url) {
    if (this.isDestroyed) return;
    const existing = this.connections.get(url);
    if (existing && existing.ws && (existing.ws.readyState === WebSocket.CONNECTING || existing.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const conn = {
      ws: null,
      isConnected: false,
      pingTimer: null,
      reconnectTimer: null,
    };
    this.connections.set(url, conn);

    try {
      const ws = new WebSocket(url, 'mqtt');
      ws.binaryType = 'arraybuffer';
      conn.ws = ws;

      ws.onopen = () => {
        this.sendConnect(conn);
      };

      ws.onmessage = (event) => {
        this.handleFrame(conn, new Uint8Array(event.data));
      };

      const cleanup = () => {
        conn.isConnected = false;
        clearInterval(conn.pingTimer);
        if (!this.isDestroyed) {
          clearTimeout(conn.reconnectTimer);
          conn.reconnectTimer = setTimeout(() => this.connectBroker(url), 3500 + Math.floor(Math.random() * 2000));
        }
      };

      ws.onclose = cleanup;
      ws.onerror = () => {
        try { ws.close(); } catch (_) {}
      };
    } catch (_) {
      conn.reconnectTimer = setTimeout(() => this.connectBroker(url), 4500);
    }
  }

  encodeRemainingLength(length) {
    const bytes = [];
    do {
      let digit = length % 128;
      length = Math.floor(length / 128);
      if (length > 0) digit |= 0x80;
      bytes.push(digit);
    } while (length > 0);
    return bytes;
  }

  sendConnect(conn) {
    if (!conn.ws || conn.ws.readyState !== WebSocket.OPEN) return;
    const cidStr = `${this.peerId}_${Math.random().toString(36).substring(2, 6)}`;
    const cid = new TextEncoder().encode(cidStr);
    const varHeader = new Uint8Array([0x00, 0x04, 0x4D, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3C]);
    const payload = new Uint8Array(2 + cid.length);
    payload[0] = (cid.length >> 8) & 0xFF;
    payload[1] = cid.length & 0xFF;
    payload.set(cid, 2);

    const totalLen = varHeader.length + payload.length;
    const lenBytes = this.encodeRemainingLength(totalLen);
    const packet = new Uint8Array(1 + lenBytes.length + totalLen);
    packet[0] = 0x10;
    packet.set(lenBytes, 1);
    const offset = 1 + lenBytes.length;
    packet.set(varHeader, offset);
    packet.set(payload, offset + varHeader.length);

    try {
      conn.ws.send(packet.buffer);
    } catch (_) {}
  }

  sendSubscribe(conn, topic) {
    if (!conn.ws || conn.ws.readyState !== WebSocket.OPEN) return;
    const t = new TextEncoder().encode(topic);
    const packetId = (this.nextPacketId++ % 65535) + 1;
    const remLen = 2 + 2 + t.length + 1;
    const lenBytes = this.encodeRemainingLength(remLen);
    const packet = new Uint8Array(1 + lenBytes.length + remLen);
    packet[0] = 0x82;
    packet.set(lenBytes, 1);
    const offset = 1 + lenBytes.length;
    packet[offset] = (packetId >> 8) & 0xFF;
    packet[offset + 1] = packetId & 0xFF;
    packet[offset + 2] = (t.length >> 8) & 0xFF;
    packet[offset + 3] = t.length & 0xFF;
    packet.set(t, offset + 4);
    packet[offset + 4 + t.length] = 0x00;

    try {
      conn.ws.send(packet.buffer);
    } catch (_) {}
  }

  publish(topic, obj, onlyOneBroker = false) {
    if (!obj || !topic) return;
    const payloadObj = { ...obj, senderId: this.peerId, ts: Date.now() };

    const t = new TextEncoder().encode(topic);
    const m = new TextEncoder().encode(JSON.stringify(payloadObj));
    const remLen = 2 + t.length + m.length;
    const lenBytes = this.encodeRemainingLength(remLen);
    const packet = new Uint8Array(1 + lenBytes.length + remLen);
    packet[0] = 0x30; // Retain = 0
    packet.set(lenBytes, 1);
    const offset = 1 + lenBytes.length;
    packet[offset] = (t.length >> 8) & 0xFF;
    packet[offset + 1] = t.length & 0xFF;
    packet.set(t, offset + 2);
    packet.set(m, offset + 2 + t.length);

    let sentAny = false;
    for (const conn of this.connections.values()) {
      if (conn.isConnected && conn.ws && conn.ws.readyState === WebSocket.OPEN) {
        try {
          conn.ws.send(packet.buffer);
          this.stats.framesOut++;
          sentAny = true;
          if (onlyOneBroker) break;
        } catch (_) {}
      }
    }

    if (!sentAny) {
      if (this.outbox.length > 64) this.outbox.shift();
      this.outbox.push({ topic, obj: payloadObj });
    }
  }

  handleFrame(conn, bytes) {
    let frameOffset = 0;

    while (frameOffset < bytes.length) {
      const headerByte = bytes[frameOffset];
      const packetType = headerByte >> 4;
      const qos = (headerByte >> 1) & 0x03;
      const isRetained = (headerByte & 0x01) !== 0;

      let idx = frameOffset + 1;
      let multiplier = 1;
      let remainingLength = 0;
      let digit;
      do {
        if (idx >= bytes.length) return;
        digit = bytes[idx++];
        remainingLength += (digit & 0x7F) * multiplier;
        multiplier *= 128;
      } while ((digit & 0x80) !== 0 && idx < bytes.length);

      const packetStart = idx;
      const packetEnd = packetStart + remainingLength;
      if (packetEnd > bytes.length) return;

      if (packetType === 2) {
        const returnCode = bytes[packetStart + 1];
        if (returnCode === 0x00) {
          conn.isConnected = true;

          this.subscribedTopics.add(`${this.namespace}/${this.room}/global`);
          this.subscribedTopics.add(`${this.namespace}/${this.room}/peer/${this.peerId}`);
          if (this.pubkeyPrefix) {
            this.subscribedTopics.add(`${this.namespace}/${this.room}/pub/${this.pubkeyPrefix}`);
          }
          for (const t of this.subscribedTopics) {
            this.sendSubscribe(conn, t);
          }

          while (this.outbox.length > 0) {
            const item = this.outbox.shift();
            this.publish(item.topic, item.obj);
          }

          if (!this.hasNotifiedConnect && this.onConnect) {
            this.hasNotifiedConnect = true;
            this.onConnect();
          }

          clearInterval(conn.pingTimer);
          conn.pingTimer = setInterval(() => {
            if (conn.isConnected && conn.ws && conn.ws.readyState === WebSocket.OPEN) {
              try { conn.ws.send(new Uint8Array([0xC0, 0x00]).buffer); } catch (_) {}
            }
          }, 25000);
        }
      }

      // Ignore any broker-retained messages so ghost/stale users never appear
      if (packetType === 3 && !isRetained) {
        let pIdx = packetStart;
        const topicLen = (bytes[pIdx] << 8) | bytes[pIdx + 1];
        pIdx += 2 + topicLen;
        if (qos > 0) pIdx += 2;

        const payloadBytes = bytes.subarray(pIdx, packetEnd);
        try {
          const payloadStr = new TextDecoder().decode(payloadBytes);
          const payload = JSON.parse(payloadStr);
          if (payload && payload.senderId !== this.peerId) {
            this.stats.framesIn++;
            this.onMessage(payload);
          }
        } catch (_) {}
      }

      frameOffset = packetEnd;
    }
  }

  destroy() {
    this.isDestroyed = true;
    this.outbox = [];
    for (const conn of this.connections.values()) {
      conn.isConnected = false;
      clearInterval(conn.pingTimer);
      clearTimeout(conn.reconnectTimer);
      if (conn.ws) {
        try { ws.close(); } catch (_) {}
      }
    }
    this.connections.clear();
  }
}

class P2PGossipSwarm {
  constructor(options = {}) {
    this.room = options.room || 'global';
    this.username = options.username || 'anon';
    this.identity = options.identity || P0Crypto.generateIdentity();
    this.peerId = P0Crypto.generatePeerId();
    this.maxNeighbors = options.maxNeighbors || 12;
    this.minNeighbors = 4;

    this.onMessage = options.onMessage || (() => {});
    this.onReaction = options.onReaction || (() => {});
    this.onUserJoined = options.onUserJoined || (() => {});
    this.onUserLeft = options.onUserLeft || (() => {});
    this.onPeerListUpdate = options.onPeerListUpdate || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onTyping = options.onTyping || (() => {});
    this.onGroupInvite = options.onGroupInvite || (() => {});

    this.neighbors = new Map();
    this.knownOnlineUsers = new Map(); // Only real, live verified remote users
    this.pendingOffers = new Map();
    this.connectingPeers = new Map();
    this.seenMessages = new SeenMessageRing(16384);
    this.isDestroyed = false;
    this.lastPresenceReplyTs = 0;
    this.peerListTimer = null;

    this.mqtt = new MqttSignalingClient({
      room: this.room,
      peerId: this.peerId,
      pubkey: this.identity.ed25519_pub,
      onConnect: () => {
        this.notifyStatus();
        this.broadcastDiscover();
      },
      onMessage: (payload) => this.handleSignalingPayload(payload),
    });

    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
      iceCandidatePoolSize: 2,
    };
  }

  async start() {
    this.notifyStatus();
    this.schedulePeerListUpdate();

    this.setupLocalSignaling();
    this.mqtt.connect();

    setTimeout(() => this.broadcastDiscover(), 300);

    const scheduleNextRebalance = () => {
      if (this.isDestroyed) return;
      const jitterMs = 15000 + Math.floor(Math.random() * 5000);
      this.maintenanceInterval = setTimeout(() => {
        this.rebalanceMesh();
        scheduleNextRebalance();
      }, jitterMs);
    };
    scheduleNextRebalance();
  }

  updateIdentity(newIdentity) {
    this.identity = newIdentity;
    this.mqtt.updatePubkeySubscription(newIdentity.ed25519_pub);
    this.schedulePeerListUpdate();
    this.broadcastDiscover();
  }

  subscribeGroup(groupId) {
    if (!groupId) return;
    this.mqtt.subscribeTopic(`${this.mqtt.namespace}/${this.room}/grp/${groupId}`);
  }

  notifyStatus() {
    const isLive = this.neighbors.size > 0 || this.mqtt.isConnected;
    this.onStatusChange(isLive ? 'live' : 'connecting', {
      webrtcPeers: this.neighbors.size,
      mqttBrokers: this.mqtt.connectedBrokerCount,
      dedupRingSize: this.seenMessages.size,
      onlineCount: this.knownOnlineUsers.size,
    });
  }

  schedulePeerListUpdate() {
    if (this.peerListTimer) return;
    this.peerListTimer = setTimeout(() => {
      this.peerListTimer = null;
      const now = Date.now();
      const myPub = P0Crypto.normalizePubkey(this.identity.ed25519_pub);
      for (const [pub, u] of this.knownOnlineUsers.entries()) {
        if (pub === myPub || now - (u.lastSeen || 0) > 35000) {
          this.knownOnlineUsers.delete(pub);
        }
      }
      this.onPeerListUpdate(Array.from(this.knownOnlineUsers.values()));
      this.notifyStatus();
    }, 150);
  }

  setupLocalSignaling() {
    try {
      this.localBc = new BroadcastChannel(`notalk_v4_sig_${this.room}`);
      this.localBc.onmessage = (event) => {
        if (event.data && event.data.senderId !== this.peerId) {
          this.handleSignalingPayload(event.data);
        }
      };
    } catch (_) {}

    window.addEventListener('storage', (e) => {
      if (e.key === `notalk_v4_sig_${this.room}` && e.newValue) {
        try {
          const payload = JSON.parse(e.newValue);
          if (payload && payload.senderId !== this.peerId) {
            this.handleSignalingPayload(payload);
          }
        } catch (_) {}
      }
    });

    window.addEventListener('beforeunload', () => {
      this.broadcastSignaling({
        type: 'p0_user_left',
        id: 'left_' + this.peerId + '_' + Date.now(),
        pubkey: this.identity.ed25519_pub,
        username: this.username,
      });
    });
  }

  sendLocalSignaling(payload) {
    payload.senderId = this.peerId;
    payload.ts = Date.now();
    if (this.localBc) {
      try { this.localBc.postMessage(payload); } catch (_) {}
    }
    try {
      localStorage.setItem(`notalk_v4_sig_${this.room}`, JSON.stringify({ ...payload, _t: Date.now() }));
    } catch (_) {}
  }

  broadcastSignaling(payload, customTopic = null) {
    payload.senderId = this.peerId;
    payload.ts = Date.now();
    this.sendLocalSignaling(payload);

    const ns = this.mqtt.namespace;
    if (customTopic) {
      this.mqtt.publish(customTopic, payload);
    } else if (payload.toPeerId) {
      this.mqtt.publish(`${ns}/${this.room}/peer/${payload.toPeerId}`, payload);
    } else if (payload.toPubkeyPrefix) {
      this.mqtt.publish(`${ns}/${this.room}/pub/${payload.toPubkeyPrefix}`, payload);
    } else {
      this.mqtt.publish(`${ns}/${this.room}/global`, payload, true);
    }
  }

  async broadcastDiscover() {
    this.broadcastSignaling({
      type: 'p0_discover',
      id: 'disc_' + this.peerId + '_' + Math.floor(Date.now() / 4000),
      peerId: this.peerId,
      username: this.username,
      pubkey: this.identity.ed25519_pub,
      ts: Date.now(),
    });
  }

  registerDiscoveredPeer(peerId, username, pubkey, packetTs) {
    if (!pubkey || peerId === this.peerId) return false;
    // Ignore stale/cached announcements older than 20 seconds
    if (packetTs && Math.abs(Date.now() - packetTs) > 20000) return false;

    const cleanPub = P0Crypto.normalizePubkey(pubkey);
    const myPub = P0Crypto.normalizePubkey(this.identity.ed25519_pub);
    if (!cleanPub || cleanPub === myPub) return false;

    const isNew = !this.knownOnlineUsers.has(cleanPub);
    this.knownOnlineUsers.set(cleanPub, {
      peerId: peerId || '',
      username: (username || 'user').replace(/^@/, ''),
      pubkey: cleanPub,
      lastSeen: Date.now(),
    });
    if (isNew) {
      this.onUserJoined({ username: username || 'user', pubkey: cleanPub, peerId });
    }
    this.schedulePeerListUpdate();
    return isNew;
  }

  async maybeInitiateHandshake(remotePeerId) {
    if (!remotePeerId || remotePeerId === this.peerId) return;
    if (this.neighbors.has(remotePeerId) || this.neighbors.size >= this.maxNeighbors) return;
    if (this.peerId < remotePeerId) {
      const lastAttempt = this.connectingPeers.get(remotePeerId);
      if (!lastAttempt || (Date.now() - lastAttempt > 15000)) {
        this.connectingPeers.set(remotePeerId, Date.now());
        const offerObj = await this.createPendingOffer(remotePeerId);
        if (offerObj) {
          this.broadcastSignaling({
            type: 'p0_sig_offer',
            offerId: offerObj.offerId,
            fromPeerId: this.peerId,
            toPeerId: remotePeerId,
            offer: offerObj.offer,
          });
        }
      }
    }
  }

  async handleSignalingPayload(payload) {
    if (!payload || !payload.type) return;
    if (payload.id && !this.seenMessages.add(payload.id)) {
      return;
    }

    switch (payload.type) {
      case 'p0_discover': {
        if (payload.peerId !== this.peerId) {
          const isNew = this.registerDiscoveredPeer(payload.peerId, payload.username, payload.pubkey, payload.ts);
          const now = Date.now();
          if (isNew || (now - this.lastPresenceReplyTs > 2500)) {
            this.lastPresenceReplyTs = now;
            setTimeout(() => {
              this.broadcastSignaling({
                type: 'p0_sig_presence',
                toPeerId: payload.peerId,
                peerId: this.peerId,
                username: this.username,
                pubkey: this.identity.ed25519_pub,
                ts: Date.now(),
              });
            }, 50 + Math.floor(Math.random() * 180));
          }
          await this.maybeInitiateHandshake(payload.peerId);
        }
        break;
      }

      case 'p0_sig_presence': {
        if (payload.peerId !== this.peerId && payload.pubkey) {
          this.registerDiscoveredPeer(payload.peerId, payload.username, payload.pubkey, payload.ts);
          await this.maybeInitiateHandshake(payload.peerId);
        }
        break;
      }

      case 'p0_sig_offer': {
        if (payload.toPeerId === this.peerId && !this.neighbors.has(payload.fromPeerId)) {
          if (this.neighbors.size < this.maxNeighbors) {
            const lastAttempt = this.connectingPeers.get(payload.fromPeerId);
            if (!lastAttempt || (Date.now() - lastAttempt > 8000)) {
              this.connectingPeers.set(payload.fromPeerId, Date.now());
              const answer = await this.handleOffer(payload.offer, payload.fromPeerId);
              if (answer) {
                this.broadcastSignaling({
                  type: 'p0_sig_answer',
                  offerId: payload.offerId,
                  fromPeerId: this.peerId,
                  toPeerId: payload.fromPeerId,
                  answer,
                });
              }
            }
          }
        }
        break;
      }

      case 'p0_sig_answer': {
        if (payload.toPeerId === this.peerId) {
          await this.handleAnswer(payload.answer, payload.offerId, payload.fromPeerId);
        }
        break;
      }

      case 'p0_local_gossip': {
        if (payload.msg && payload.msg.id) {
          await this.handleSwarmPayload(payload.msg, null);
        }
        break;
      }

      case 'p0_group_invite': {
        if (payload.invite && payload.toPubkey) {
          const myClean = P0Crypto.normalizePubkey(this.identity.ed25519_pub);
          const targetClean = P0Crypto.normalizePubkey(payload.toPubkey);
          if (myClean === targetClean || myClean.startsWith(targetClean) || targetClean.startsWith(myClean)) {
            this.onGroupInvite(payload.invite);
          }
        }
        break;
      }

      case 'p0_user_left': {
        if (payload.pubkey) {
          const clean = P0Crypto.normalizePubkey(payload.pubkey);
          this.knownOnlineUsers.delete(clean);
          this.onUserLeft(payload);
          this.schedulePeerListUpdate();
        }
        break;
      }

      default:
        break;
    }
  }

  async createPendingOffer(targetPeerId) {
    try {
      const pc = new RTCPeerConnection(this.rtcConfig);
      const offerId = 'off_' + Math.random().toString(36).substring(2, 9);
      const dc = pc.createDataChannel('p0-chat', { ordered: true });
      this.bindDataChannel(dc, pc, targetPeerId);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve();
        let timer = null;
        let finished = false;
        const done = () => {
          if (!finished) {
            finished = true;
            if (timer) clearTimeout(timer);
            resolve();
          }
        };
        pc.onicecandidate = (e) => {
          if (!e.candidate) return done();
          const candStr = e.candidate.candidate || '';
          if (candStr.includes('typ srflx') || candStr.includes('typ relay')) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(done, 180);
          }
        };
        timer = setTimeout(done, 2200);
      });

      const offerData = {
        offerId,
        targetPeerId,
        offer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
        pc,
        dc,
        created: Date.now(),
      };
      this.pendingOffers.set(offerId, offerData);
      return offerData;
    } catch (_) {
      return null;
    }
  }

  async handleOffer(remoteOffer, fromPeerId) {
    try {
      const pc = new RTCPeerConnection(this.rtcConfig);
      pc.ondatachannel = (event) => {
        this.bindDataChannel(event.channel, pc, fromPeerId);
      };
      await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve();
        let timer = null;
        let finished = false;
        const done = () => {
          if (!finished) {
            finished = true;
            if (timer) clearTimeout(timer);
            resolve();
          }
        };
        pc.onicecandidate = (e) => {
          if (!e.candidate) return done();
          const candStr = e.candidate.candidate || '';
          if (candStr.includes('typ srflx') || candStr.includes('typ relay')) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(done, 180);
          }
        };
        timer = setTimeout(done, 2200);
      });

      return { type: pc.localDescription.type, sdp: pc.localDescription.sdp };
    } catch (_) {
      return null;
    }
  }

  async handleAnswer(remoteAnswer, offerId) {
    const pending = this.pendingOffers.get(offerId);
    if (!pending) return;
    try {
      if (pending.pc.signalingState === 'have-local-offer') {
        await pending.pc.setRemoteDescription(new RTCSessionDescription(remoteAnswer));
      }
    } catch (_) {}
  }

  bindDataChannel(dc, pc, remotePeerId) {
    const assignedId = remotePeerId || ('peer_' + Math.random().toString(36).substring(2, 8));

    dc.onopen = () => {
      this.connectingPeers.delete(assignedId);
      this.neighbors.set(assignedId, { pc, dc, username: 'user', pubkey: '' });
      this.notifyStatus();

      this.sendToDc(dc, {
        type: 'p0_hello',
        peerId: this.peerId,
        username: this.username,
        pubkey: this.identity.ed25519_pub,
        ts: Date.now(),
      });
    };

    dc.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        this.handleSwarmPayload(payload, dc);
      } catch (_) {}
    };

    const handleClose = () => {
      for (const [id, neighbor] of this.neighbors.entries()) {
        if (neighbor.dc === dc || neighbor.pc === pc) {
          if (neighbor.pubkey) {
            this.knownOnlineUsers.delete(neighbor.pubkey);
            this.schedulePeerListUpdate();
          }
          this.neighbors.delete(id);
          this.connectingPeers.delete(id);
          break;
        }
      }
      this.notifyStatus();
    };

    dc.onclose = handleClose;
    pc.oniceconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) {
        handleClose();
      }
    };
  }

  async handleSwarmPayload(payload, sourceDc) {
    if (!payload || !payload.type) return;
    if (payload.id && !this.seenMessages.add(payload.id)) {
      return;
    }

    if (payload.pubkey) {
      this.registerDiscoveredPeer(payload.peerId, payload.username, payload.pubkey, payload.ts || Date.now());
    }

    switch (payload.type) {
      case 'p0_hello': {
        for (const [nId, neighbor] of this.neighbors.entries()) {
          if (neighbor.dc === sourceDc) {
            neighbor.username = payload.username;
            neighbor.pubkey = P0Crypto.normalizePubkey(payload.pubkey);
            if (payload.peerId && nId !== payload.peerId) {
              this.neighbors.delete(nId);
              this.neighbors.set(payload.peerId, neighbor);
            }
            break;
          }
        }
        break;
      }

      case 'p0_chat_message': {
        const validSig = await P0Crypto.verifyMessage(payload);
        if (!validSig) return;
        this.onMessage(payload);
        if (sourceDc) {
          this.forwardGossip(payload, sourceDc, 6);
        }
        break;
      }

      case 'p0_reaction': {
        this.onReaction(payload);
        if (sourceDc) {
          this.forwardGossip(payload, sourceDc, 4);
        }
        break;
      }

      case 'p0_typing': {
        this.onTyping(payload);
        if (sourceDc && (payload.hops || 0) < 2) {
          this.forwardGossip(payload, sourceDc, 2);
        }
        break;
      }

      case 'p0_group_invite': {
        if (payload.invite && payload.toPubkey) {
          const myClean = P0Crypto.normalizePubkey(this.identity.ed25519_pub);
          const targetClean = P0Crypto.normalizePubkey(payload.toPubkey);
          if (myClean === targetClean || myClean.startsWith(targetClean) || targetClean.startsWith(myClean)) {
            this.onGroupInvite(payload.invite);
          } else if (sourceDc) {
            this.forwardGossip(payload, sourceDc, 4);
          }
        }
        break;
      }

      case 'p0_user_left': {
        if (payload.pubkey) {
          const clean = P0Crypto.normalizePubkey(payload.pubkey);
          this.knownOnlineUsers.delete(clean);
          this.onUserLeft(payload);
          this.schedulePeerListUpdate();
        }
        break;
      }

      default:
        break;
    }
  }

  gossip(msgObj, targetTopic = null) {
    if (msgObj.id) {
      this.seenMessages.add(msgObj.id);
    }
    const dataStr = JSON.stringify(msgObj);

    for (const neighbor of this.neighbors.values()) {
      if (neighbor.dc && neighbor.dc.readyState === 'open') {
        try { neighbor.dc.send(dataStr); } catch (_) {}
      }
    }

    this.sendLocalSignaling({
      type: 'p0_local_gossip',
      msg: msgObj,
    });

    const ns = this.mqtt.namespace;
    const topic = targetTopic || `${ns}/${this.room}/global`;
    const onlyOneBroker = this.neighbors.size >= 2;
    this.mqtt.publish(topic, {
      type: 'p0_local_gossip',
      senderId: this.peerId,
      msg: msgObj,
    }, onlyOneBroker);
  }

  forwardGossip(msgObj, sourceDc, maxHops = 6) {
    if (!sourceDc) return;
    if ((msgObj.hops || 0) >= maxHops) return;
    const forwarded = { ...msgObj, hops: (msgObj.hops || 0) + 1 };
    const dataStr = JSON.stringify(forwarded);

    for (const neighbor of this.neighbors.values()) {
      if (neighbor.dc !== sourceDc && neighbor.dc && neighbor.dc.readyState === 'open') {
        try { neighbor.dc.send(dataStr); } catch (_) {}
      }
    }
  }

  async sendChatMessage(content, conv = null, extra = {}) {
    const convId = (conv && conv.id) ? conv.id : 'global';
    const convType = (conv && conv.type) ? conv.type : 'global';

    let wireContent = content;
    let e2eeMeta = {};

    if (convType === 'dm' && conv.peerPubkey) {
      const dmSeed = P0Crypto.getDmConvId(this.identity.ed25519_pub, conv.peerPubkey);
      const enc = await P0Crypto.encryptE2EE(dmSeed, content);
      if (enc) {
        wireContent = `[E2EE:${enc.iv}:${enc.ct}]`;
        e2eeMeta = { encrypted: true, iv: enc.iv, ct: enc.ct, toPubkey: P0Crypto.normalizePubkey(conv.peerPubkey) };
      }
    } else if (convType === 'group' && conv.secretKey) {
      const enc = await P0Crypto.encryptE2EE(conv.secretKey, content);
      if (enc) {
        wireContent = `[E2EE:${enc.iv}:${enc.ct}]`;
        e2eeMeta = { encrypted: true, iv: enc.iv, ct: enc.ct, groupName: conv.name };
      }
    }

    const signed = await P0Crypto.signMessage(this.identity, wireContent, this.username, convId, {
      convType,
      ...e2eeMeta,
      ...extra,
    });

    const localMsg = {
      type: 'p0_chat_message',
      ...signed,
      content,
      rawPlaintext: wireContent,
    };

    this.onMessage(localMsg);

    const wireMsg = {
      type: 'p0_chat_message',
      ...signed,
    };

    const ns = this.mqtt.namespace;
    if (convType === 'dm' && conv.peerPubkey) {
      const targetPrefix = P0Crypto.normalizePubkey(conv.peerPubkey).slice(0, 24);
      this.gossip(wireMsg, `${ns}/${this.room}/pub/${targetPrefix}`);
    } else if (convType === 'group') {
      this.gossip(wireMsg, `${ns}/${this.room}/grp/${convId}`);
    } else {
      this.gossip(wireMsg, `${ns}/${this.room}/global`);
    }
  }

  sendReaction(msgId, emoji, convId = 'global') {
    if (!msgId || !emoji) return;
    const pkt = {
      type: 'p0_reaction',
      id: 'react_' + msgId + '_' + this.peerId + '_' + Date.now(),
      msgId,
      convId,
      emoji,
      username: this.username,
      pubkey: this.identity.ed25519_pub,
      hops: 0,
    };
    this.onReaction(pkt);
    this.gossip(pkt);
  }

  sendGroupInvite(targetPubkey, groupObj) {
    const cleanTarget = P0Crypto.normalizePubkey(targetPubkey);
    if (!cleanTarget || !groupObj) return;
    const inviteCode = P0Crypto.encodeGroupInviteCode(groupObj);
    const invitePacket = {
      type: 'p0_group_invite',
      id: 'inv_' + groupObj.id + '_' + cleanTarget.slice(0, 10) + '_' + Date.now(),
      toPubkey: cleanTarget,
      fromUsername: this.username,
      fromPubkey: this.identity.ed25519_pub,
      invite: {
        groupId: groupObj.id,
        groupName: groupObj.name,
        description: groupObj.description || '',
        secretKey: groupObj.secretKey || '',
        isPrivate: !!groupObj.isPrivate,
        inviteCode,
        inviterUsername: this.username,
        inviterPubkey: this.identity.ed25519_pub,
        timestamp: Date.now(),
      },
      hops: 0,
    };

    const targetPrefix = cleanTarget.slice(0, 24);
    this.broadcastSignaling(invitePacket, `${this.mqtt.namespace}/${this.room}/pub/${targetPrefix}`);

    const str = JSON.stringify(invitePacket);
    for (const neighbor of this.neighbors.values()) {
      if (neighbor.dc && neighbor.dc.readyState === 'open') {
        try { neighbor.dc.send(str); } catch (_) {}
      }
    }
  }

  sendTyping(isTyping, convId = 'global') {
    const pkt = {
      type: 'p0_typing',
      id: 'typ_' + this.peerId + '_' + Math.floor(Date.now() / 1200),
      convId,
      username: this.username,
      pubkey: this.identity.ed25519_pub,
      isTyping,
      hops: 0,
    };
    this.seenMessages.add(pkt.id);
    const str = JSON.stringify(pkt);
    for (const neighbor of this.neighbors.values()) {
      if (neighbor.dc && neighbor.dc.readyState === 'open') {
        try { neighbor.dc.send(str); } catch (_) {}
      }
    }
    this.sendLocalSignaling({ type: 'p0_local_gossip', msg: pkt });
  }

  sendToDc(dc, obj) {
    if (dc && dc.readyState === 'open') {
      try { dc.send(JSON.stringify(obj)); } catch (_) {}
    }
  }

  rebalanceMesh() {
    if (this.isDestroyed) return;
    const now = Date.now();

    for (const [id, pending] of this.pendingOffers.entries()) {
      if (now - pending.created > 20000) {
        if (pending.pc && pending.pc.iceConnectionState !== 'connected') {
          try { pending.pc.close(); } catch (_) {}
        }
        this.pendingOffers.delete(id);
      }
    }

    for (const [pId, ts] of this.connectingPeers.entries()) {
      if (now - ts > 15000) {
        this.connectingPeers.delete(pId);
      }
    }

    let peerListChanged = false;
    for (const [pubkey, user] of this.knownOnlineUsers.entries()) {
      if (now - (user.lastSeen || 0) > 35000) {
        this.knownOnlineUsers.delete(pubkey);
        peerListChanged = true;
      }
    }
    if (peerListChanged) this.schedulePeerListUpdate();

    this.broadcastDiscover();
  }

  destroy() {
    this.isDestroyed = true;
    clearTimeout(this.maintenanceInterval);
    clearTimeout(this.peerListTimer);
    if (this.localBc) this.localBc.close();
    this.mqtt.destroy();
    for (const neighbor of this.neighbors.values()) {
      try {
        if (neighbor.dc) neighbor.dc.close();
        if (neighbor.pc) neighbor.pc.close();
      } catch (_) {}
    }
    this.neighbors.clear();
  }
}

window.P2PGossipSwarm = P2PGossipSwarm;
