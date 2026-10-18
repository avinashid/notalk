/**
 * Protocol Zero P2P Bounded-Degree WebRTC Gossip Swarm (v3.0)
 * Completely Serverless — Multi-Channel Signaling (BroadcastChannel + Trackers + Nostr)
 */

class P2PGossipSwarm {
  constructor(options = {}) {
    this.room = options.room || 'global';
    this.username = options.username || 'anon';
    this.identity = options.identity || P0Crypto.generateIdentity();
    this.peerId = P0Crypto.generatePeerId();
    this.maxNeighbors = options.maxNeighbors || 6;
    this.minNeighbors = 3;

    // Callbacks
    this.onMessage = options.onMessage || (() => {});
    this.onUserJoined = options.onUserJoined || (() => {});
    this.onUserLeft = options.onUserLeft || (() => {});
    this.onPeerListUpdate = options.onPeerListUpdate || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onTyping = options.onTyping || (() => {});

    // Active Mesh State
    this.neighbors = new Map(); // peerId -> { pc, dc, username, pubkey }
    this.knownOnlineUsers = new Map(); // pubkey -> { peerId, username, pubkey, lastSeen }
    this.pendingOffers = new Map(); // offerId -> { pc, dc, created: timestamp }
    this.seenMessages = new Set();
    this.trackerSockets = [];
    this.isDestroyed = false;

    // Public Signaling Trackers
    this.trackerUrls = [
      'wss://tracker.openwebtorrent.com',
      'wss://tracker.webtorrent.dev',
      'wss://tracker.files.fm:7073/announce',
    ];

    // Public Nostr Relays for Cross-Device Signaling
    this.nostrRelays = [
      'wss://relay.damus.io',
      'wss://nos.lol',
    ];

    // Free Public STUN Servers
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
      ],
      iceCandidatePoolSize: 2,
    };
  }

  async start() {
    this.infoHashHex = await P0Crypto.sha1Hex(`protocol-zero-v3-room-${this.room}`);
    this.onStatusChange('connecting', 0);

    // Register self in online users
    this.knownOnlineUsers.set(this.identity.ed25519_pub, {
      peerId: this.peerId,
      username: this.username,
      pubkey: this.identity.ed25519_pub,
      lastSeen: Date.now(),
    });
    this.notifyPeerList();

    // 1. Setup Local Cross-Tab / Cross-Browser Signaling (BroadcastChannel + LocalStorage)
    this.setupLocalSignaling();

    // 2. Setup Public WebTorrent Tracker Signaling
    this.connectTrackers();

    // 3. Setup Nostr Ephemeral Signaling
    this.connectNostr();

    // 4. Send initial join beacon
    setTimeout(() => this.broadcastDiscover(), 300);

    // 5. Periodic maintenance (clean old offers, ensure minimum neighbors)
    this.maintenanceInterval = setInterval(() => {
      this.rebalanceMesh();
    }, 10000);
  }

  // ---------------------------------------------------------------------------
  // Signaling Layer 1: Local Cross-Browser / Cross-Tab (0ms Latency)
  // ---------------------------------------------------------------------------
  setupLocalSignaling() {
    try {
      this.localBc = new BroadcastChannel(`p0_sig_${this.room}`);
      this.localBc.onmessage = (event) => {
        if (event.data && event.data.senderId !== this.peerId) {
          this.handleSignalingPayload(event.data);
        }
      };
    } catch (_) {}

    // Storage event for browsers without BroadcastChannel support
    window.addEventListener('storage', (e) => {
      if (e.key === `p0_sig_${this.room}` && e.newValue) {
        try {
          const payload = JSON.parse(e.newValue);
          if (payload && payload.senderId !== this.peerId) {
            this.handleSignalingPayload(payload);
          }
        } catch (_) {}
      }
    });

    window.addEventListener('beforeunload', () => {
      this.sendLocalSignaling({
        type: 'p0_local_gossip',
        msg: {
          type: 'p0_user_left',
          id: 'leave_' + this.identity.ed25519_pub + '_' + Date.now(),
          pubkey: this.identity.ed25519_pub,
          username: this.username,
        }
      });
    });
  }

  sendLocalSignaling(payload) {
    payload.senderId = this.peerId;
    if (this.localBc) {
      try { this.localBc.postMessage(payload); } catch (_) {}
    }
    try {
      localStorage.setItem(`p0_sig_${this.room}`, JSON.stringify({ ...payload, _t: Date.now() }));
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Signaling Layer 2: Public WebTorrent Trackers
  // ---------------------------------------------------------------------------
  connectTrackers() {
    this.trackerUrls.forEach((url) => {
      try {
        const ws = new WebSocket(url);
        this.trackerSockets.push(ws);

        ws.onopen = () => {
          this.announceToTracker(ws);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleTrackerMessage(data, ws);
          } catch (_) {}
        };

        ws.onclose = () => {
          if (!this.isDestroyed) {
            setTimeout(() => this.reconnectTracker(url), 12000);
          }
        };

        ws.onerror = () => ws.close();
      } catch (_) {}
    });
  }

  reconnectTracker(url) {
    if (this.isDestroyed) return;
    this.trackerSockets = this.trackerSockets.filter(s => s.url !== url);
    try {
      const ws = new WebSocket(url);
      this.trackerSockets.push(ws);
      ws.onopen = () => this.announceToTracker(ws);
      ws.onmessage = (e) => {
        try { this.handleTrackerMessage(JSON.parse(e.data), ws); } catch (_) {}
      };
      ws.onclose = () => setTimeout(() => this.reconnectTracker(url), 12000);
    } catch (_) {}
  }

  async announceToTracker(ws) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (this.neighbors.size >= this.maxNeighbors) return;

    const offerObj = await this.createPendingOffer(null);
    if (!offerObj) return;

    const announceMsg = {
      action: 'announce',
      info_hash: this.infoHashHex,
      peer_id: this.peerId,
      numwant: 8,
      offers: [{
        offer_id: offerObj.offerId,
        offer: offerObj.offer,
      }],
    };

    ws.send(JSON.stringify(announceMsg));
  }

  async handleTrackerMessage(msg, ws) {
    if (msg.action !== 'announce') return;

    // Tracker forwarded an offer to us
    if (msg.offer && msg.peer_id && msg.offer_id) {
      if (msg.peer_id === this.peerId || this.neighbors.has(msg.peer_id)) return;
      if (this.neighbors.size >= this.maxNeighbors) return;

      const answer = await this.handleOffer(msg.offer, msg.peer_id);
      if (answer) {
        const answerPayload = {
          action: 'announce',
          info_hash: this.infoHashHex,
          peer_id: this.peerId,
          to_peer_id: msg.peer_id,
          offer_id: msg.offer_id,
          answer: answer,
        };
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(answerPayload));
        }
      }
      return;
    }

    // Tracker forwarded an answer to us
    if (msg.answer && msg.offer_id) {
      await this.handleAnswer(msg.answer, msg.offer_id, msg.peer_id);
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // Signaling Layer 3: Public Nostr Ephemeral Events
  // ---------------------------------------------------------------------------
  connectNostr() {
    this.nostrSockets = [];
    this.nostrRelays.forEach((url) => {
      try {
        const ws = new WebSocket(url);
        this.nostrSockets.push(ws);

        ws.onopen = () => {
          // Subscribe to ephemeral signaling events for this room
          const subId = 'sub_' + Math.random().toString(36).substring(2, 8);
          const req = ['REQ', subId, {
            kinds: [20001],
            '#t': [`p0-${this.room}`],
            limit: 20,
          }];
          ws.send(JSON.stringify(req));
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data[0] === 'EVENT' && data[2] && data[2].content) {
              const sigPayload = JSON.parse(data[2].content);
              if (sigPayload && sigPayload.senderId !== this.peerId) {
                this.handleSignalingPayload(sigPayload);
              }
            }
          } catch (_) {}
        };
      } catch (_) {}
    });
  }

  sendNostrSignaling(payload) {
    payload.senderId = this.peerId;
    const content = JSON.stringify(payload);
    const event = {
      kind: 20001,
      pubkey: this.identity.ed25519_pub,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', `p0-${this.room}`]],
      content: content,
      id: '',
      sig: '',
    };

    this.nostrSockets.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(['EVENT', event]));
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Unified Signaling Dispatcher
  // ---------------------------------------------------------------------------
  broadcastSignaling(payload) {
    this.sendLocalSignaling(payload);
    this.sendNostrSignaling(payload);
  }

  async broadcastDiscover() {
    this.broadcastSignaling({
      type: 'p0_discover',
      peerId: this.peerId,
      username: this.username,
      pubkey: this.identity.ed25519_pub,
    });
  }

  async handleSignalingPayload(payload) {
    if (!payload || !payload.type) return;

    switch (payload.type) {
      case 'p0_discover':
        // A new peer announced presence. If we have room for neighbors, send them an offer.
        if (payload.peerId !== this.peerId) {
          if (payload.pubkey) {
            this.knownOnlineUsers.set(payload.pubkey, {
              peerId: payload.peerId,
              username: payload.username,
              pubkey: payload.pubkey,
              lastSeen: Date.now(),
            });
            this.notifyPeerList();
          }

          // Reply with our presence so the discoverer immediately sees us
          this.sendLocalSignaling({
            type: 'p0_sig_presence',
            peerId: this.peerId,
            username: this.username,
            pubkey: this.identity.ed25519_pub,
          });

          if (!this.neighbors.has(payload.peerId) && this.neighbors.size < this.maxNeighbors) {
            // Tie-break: smaller peerId initiates offer to prevent duplicate connections
            if (this.peerId < payload.peerId) {
              const offerObj = await this.createPendingOffer(payload.peerId);
              if (offerObj) {
                this.broadcastSignaling({
                  type: 'p0_sig_offer',
                  offerId: offerObj.offerId,
                  fromPeerId: this.peerId,
                  toPeerId: payload.peerId,
                  offer: offerObj.offer,
                });
              }
            }
          }
        }
        break;

      case 'p0_sig_presence':
        if (payload.peerId !== this.peerId && payload.pubkey) {
          this.knownOnlineUsers.set(payload.pubkey, {
            peerId: payload.peerId,
            username: payload.username,
            pubkey: payload.pubkey,
            lastSeen: Date.now(),
          });
          this.notifyPeerList();
        }
        break;

      case 'p0_local_gossip':
        if (payload.msg && payload.msg.id) {
          if (this.seenMessages.has(payload.msg.id)) break;
          this.seenMessages.add(payload.msg.id);
          this.handleSwarmPayload(payload.msg, null);
        }
        break;

      case 'p0_sig_offer':
        if (payload.toPeerId === this.peerId && !this.neighbors.has(payload.fromPeerId)) {
          if (this.neighbors.size < this.maxNeighbors) {
            const answer = await this.handleOffer(payload.offer, payload.fromPeerId);
            if (answer) {
              this.broadcastSignaling({
                type: 'p0_sig_answer',
                offerId: payload.offerId,
                fromPeerId: this.peerId,
                toPeerId: payload.fromPeerId,
                answer: answer,
              });
            }
          }
        }
        break;

      case 'p0_sig_answer':
        if (payload.toPeerId === this.peerId) {
          await this.handleAnswer(payload.answer, payload.offerId, payload.fromPeerId);
        }
        break;

      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // WebRTC Handshake Engine
  // ---------------------------------------------------------------------------
  async createPendingOffer(targetPeerId) {
    try {
      const pc = new RTCPeerConnection(this.rtcConfig);
      const offerId = 'off_' + Math.random().toString(36).substring(2, 9);
      
      const dc = pc.createDataChannel('p0-chat', { ordered: true });
      this.bindDataChannel(dc, pc, targetPeerId);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Gather ICE candidates
      await new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
        } else {
          pc.onicecandidate = (e) => {
            if (!e.candidate) resolve();
          };
          setTimeout(resolve, 800);
        }
      });

      const offerData = {
        offerId,
        targetPeerId,
        offer: {
          type: pc.localDescription.type,
          sdp: pc.localDescription.sdp,
        },
        pc,
        dc,
        created: Date.now(),
      };

      this.pendingOffers.set(offerId, offerData);
      return offerData;
    } catch (e) {
      console.warn('Failed to create offer:', e);
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

      // Gather ICE candidates
      await new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') resolve();
        else {
          pc.onicecandidate = (e) => {
            if (!e.candidate) resolve();
          };
          setTimeout(resolve, 800);
        }
      });

      return {
        type: pc.localDescription.type,
        sdp: pc.localDescription.sdp,
      };
    } catch (e) {
      console.warn('Failed to handle incoming offer:', e);
      return null;
    }
  }

  async handleAnswer(remoteAnswer, offerId, fromPeerId) {
    const pending = this.pendingOffers.get(offerId);
    if (!pending) return;

    try {
      if (pending.pc.signalingState === 'have-local-offer') {
        await pending.pc.setRemoteDescription(new RTCSessionDescription(remoteAnswer));
        this.pendingOffers.delete(offerId);
      }
    } catch (e) {
      console.warn('Failed to set remote answer:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // DataChannel Binding & Swarm Messaging
  // ---------------------------------------------------------------------------
  bindDataChannel(dc, pc, remotePeerId) {
    dc.onopen = () => {
      const assignedId = remotePeerId || ('peer_' + Math.random().toString(36).substring(2, 8));
      this.neighbors.set(assignedId, {
        pc,
        dc,
        username: 'anonymous',
        pubkey: '',
      });

      this.onStatusChange('live', this.neighbors.size);

      // Send Protocol Zero hello
      this.sendToDc(dc, {
        type: 'p0_hello',
        peerId: this.peerId,
        username: this.username,
        pubkey: this.identity.ed25519_pub,
        knownUsers: Array.from(this.knownOnlineUsers.values()),
      });
    };

    dc.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        this.handleSwarmPayload(payload, dc);
      } catch (e) {
        console.warn('Malformed swarm frame:', event.data);
      }
    };

    const handleClose = () => {
      let droppedPeer = null;
      for (const [id, neighbor] of this.neighbors.entries()) {
        if (neighbor.dc === dc || neighbor.pc === pc) {
          droppedPeer = neighbor;
          this.neighbors.delete(id);
          break;
        }
      }

      if (droppedPeer && droppedPeer.pubkey) {
        this.knownOnlineUsers.delete(droppedPeer.pubkey);
        this.onUserLeft({
          username: droppedPeer.username,
          pubkey: droppedPeer.pubkey,
        });
        this.notifyPeerList();

        // Gossip user_leave across swarm
        this.gossip({
          type: 'p0_user_left',
          id: 'leave_' + droppedPeer.pubkey + '_' + Date.now(),
          pubkey: droppedPeer.pubkey,
          username: droppedPeer.username,
          hops: 0,
        });
      }

      this.onStatusChange(this.neighbors.size > 0 ? 'live' : 'connecting', this.neighbors.size);

      if (this.neighbors.size < this.minNeighbors) {
        this.broadcastDiscover();
      }
    };

    dc.onclose = handleClose;
    pc.oniceconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) {
        handleClose();
      }
    };
  }

  handleSwarmPayload(payload, sourceDc) {
    if (!payload || !payload.type) return;

    if (payload.id) {
      if (this.seenMessages.has(payload.id)) return;
      this.seenMessages.add(payload.id);
      if (this.seenMessages.size > 1000) {
        const first = this.seenMessages.values().next().value;
        this.seenMessages.delete(first);
      }
    }

    switch (payload.type) {
      case 'p0_hello':
        for (const neighbor of this.neighbors.values()) {
          if (neighbor.dc === sourceDc) {
            neighbor.username = payload.username;
            neighbor.pubkey = payload.pubkey;
            break;
          }
        }

        if (payload.pubkey) {
          this.knownOnlineUsers.set(payload.pubkey, {
            peerId: payload.peerId,
            username: payload.username,
            pubkey: payload.pubkey,
            lastSeen: Date.now(),
          });
          this.onUserJoined({
            username: payload.username,
            pubkey: payload.pubkey,
          });
          this.notifyPeerList();
        }

        if (Array.isArray(payload.knownUsers)) {
          payload.knownUsers.forEach((u) => {
            if (u.pubkey && !this.knownOnlineUsers.has(u.pubkey)) {
              this.knownOnlineUsers.set(u.pubkey, u);
              this.onUserJoined(u);
            }
          });
          this.notifyPeerList();
        }
        break;

      case 'p0_chat_message':
        this.onMessage(payload);
        this.forwardGossip(payload, sourceDc);
        break;

      case 'p0_typing':
        this.onTyping(payload);
        this.forwardGossip(payload, sourceDc);
        break;

      case 'p0_user_left':
        if (payload.pubkey) {
          this.knownOnlineUsers.delete(payload.pubkey);
          this.onUserLeft(payload);
          this.notifyPeerList();
        }
        this.forwardGossip(payload, sourceDc);
        break;

      default:
        break;
    }
  }

  gossip(msgObj) {
    if (msgObj.id) {
      this.seenMessages.add(msgObj.id);
    }
    const dataStr = JSON.stringify(msgObj);
    for (const neighbor of this.neighbors.values()) {
      if (neighbor.dc && neighbor.dc.readyState === 'open') {
        neighbor.dc.send(dataStr);
      }
    }
    // Instantaneous cross-tab & cross-window local broadcast
    this.sendLocalSignaling({
      type: 'p0_local_gossip',
      msg: msgObj,
    });
  }

  forwardGossip(msgObj, sourceDc) {
    if ((msgObj.hops || 0) >= 8) return;
    msgObj.hops = (msgObj.hops || 0) + 1;
    const dataStr = JSON.stringify(msgObj);

    for (const neighbor of this.neighbors.values()) {
      if (neighbor.dc !== sourceDc && neighbor.dc && neighbor.dc.readyState === 'open') {
        neighbor.dc.send(dataStr);
      }
    }
  }

  async sendChatMessage(content) {
    const signed = await P0Crypto.signMessage(this.identity, content, this.username, this.room);
    const swarmMsg = {
      type: 'p0_chat_message',
      ...signed,
    };

    this.onMessage(swarmMsg);
    this.gossip(swarmMsg);
  }

  sendTyping(isTyping) {
    this.gossip({
      type: 'p0_typing',
      id: 'typing_' + this.identity.ed25519_pub + '_' + Date.now(),
      username: this.username,
      pubkey: this.identity.ed25519_pub,
      isTyping,
      hops: 0,
    });
  }

  sendToDc(dc, obj) {
    if (dc && dc.readyState === 'open') {
      dc.send(JSON.stringify(obj));
    }
  }

  notifyPeerList() {
    this.onPeerListUpdate(Array.from(this.knownOnlineUsers.values()));
  }

  rebalanceMesh() {
    if (this.isDestroyed) return;
    // Clean old expired offers older than 15s
    const now = Date.now();
    for (const [id, pending] of this.pendingOffers.entries()) {
      if (now - pending.created > 15000) {
        if (pending.pc) pending.pc.close();
        this.pendingOffers.delete(id);
      }
    }

    if (this.neighbors.size < this.minNeighbors) {
      this.broadcastDiscover();
    }
  }

  destroy() {
    this.isDestroyed = true;
    clearInterval(this.maintenanceInterval);
    if (this.localBc) this.localBc.close();
    this.trackerSockets.forEach((ws) => ws.close());
    if (this.nostrSockets) this.nostrSockets.forEach((ws) => ws.close());
    for (const neighbor of this.neighbors.values()) {
      if (neighbor.dc) neighbor.dc.close();
      if (neighbor.pc) neighbor.pc.close();
    }
    this.neighbors.clear();
  }
}

window.P2PGossipSwarm = P2PGossipSwarm;
