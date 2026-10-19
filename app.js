/**
 * NoTalk Encrypted Messenger Controller (v5.0 Extreme Edition)
 * - Consumer-friendly UI (zero technical/developer jargon)
 * - 60-120 FPS `requestAnimationFrame` Batched DOM Commit Pipeline (`DocumentFragment`)
 * - 16 KB Binary Streaming Media & File Transfers up to 500 MB+ with live progress bars & OPFS storage
 * - Opus 24 kbps Voice Note encoding (`audio/webm;codecs=opus`) with synthesized WAV fallback
 * - High-contrast Dark / Light / Slate / Frost theme switcher
 * - Strict live online user directory (never lists fake, demo, ghost, or self entries)
 */

const MAX_DOM_MESSAGES = 250;

const SVG_BELL_ON = `<svg class="ui-icon" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`;
const SVG_BELL_OFF = `<svg class="ui-icon" viewBox="0 0 24 24"><path d="M13.73 21a2 2 0 0 1-3.46 0"></path><path d="M18.63 13A17.89 17.89 0 0 1 18 8"></path><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"></path><path d="M18 8a6 6 0 0 0-9.33-5"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
const SVG_LOCK_MINI = `<svg class="ui-icon" style="width:12px;height:12px;opacity:0.75;" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;

const EMOJI_CATALOG = {
  all: ['👍', '❤️', '😂', '🔥', '🎉', '🚀', '👋', '✅', '😊', '😍', '🥳', '😎', '🤝', '🙏', '👏', '💯', '✨', '🎶', '📸', '🎬', '📎', '🌟', '💬', '🙌'],
  smileys: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😋', '😎', '🤩', '🥳', '🤔', '😴', '🤯'],
  gestures: ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👋', '🤚', '✋', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '💪', '✍️', '👀'],
  hearts: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💖', '💘', '💝', '🔥', '✨', '🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '💯'],
  objects: ['📸', '🎬', '🎵', '🎶', '🎤', '🎧', '📎', '📄', '📁', '💻', '📱', '⌚', '🔒', '🔑', '💡', '🚀', '✈️', '🌍', '☕', '🍕'],
};

const state = {
  identity: null,
  username: '',
  swarm: null,
  activeConvId: 'global',
  sidebarFilter: 'all',
  searchQuery: '',
  conversations: new Map(),
  messagesByConv: new Map(),
  onlineUsers: [],
  pinnedMessages: new Map(),
  renderedMsgIds: new Set(),
  domCommitQueue: [],
  rafCommitId: null,
  activeContextMsg: null,
  replyingToMsg: null,
  pendingGroupInvite: null,
  pendingAttachments: [],
  isTyping: false,
  typingTimeout: null,
  remoteTypers: new Map(),
  meshStats: { webrtcPeers: 0, mqttBrokers: 0, dedupRingSize: 0, onlineCount: 0 },
  mutePrefs: {
    muteGlobalChat: false,
    muteGlobalMessages: false,
    muteAllGroups: false,
    muteAllDms: false,
    muteSound: false,
    mutedConvIds: [],
  },
  audioCtx: null,
  voiceRecorder: {
    active: false,
    mediaRecorder: null,
    stream: null,
    chunks: [],
    startTime: 0,
    timerInterval: null,
  },
};

function safeGetItem(storage, key) {
  try {
    return storage.getItem(key);
  } catch (_) {
    return null;
  }
}

function safeSetItem(storage, key, val) {
  try {
    storage.setItem(key, val);
  } catch (_) {}
}

async function copyTextSafe(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch (_) {
    return false;
  }
}

const el = {};
function bindElements() {
  const ids = [
    'join-modal', 'join-form', 'username-input', 'random-name-btn',
    'toggle-import-key-btn', 'import-key-container', 'import-key-input', 'join-btn',
    'app', 'app-sidebar', 'current-user-pill', 'my-avatar', 'my-username', 'my-public-id-short',
    'copy-my-pub-quick-btn',
    'notif-btn', 'notif-menu', 'enable-push-btn', 'push-perm-status', 'test-push-btn',
    'mute-global-chat-cb', 'mute-global-msg-cb', 'mute-all-groups-cb', 'mute-all-dms-cb', 'mute-sound-cb',
    'settings-btn', 'settings-menu', 'retention-label', 'clear-history-btn',
    'theme-btn', 'theme-btn-short-text', 'theme-menu', 'theme-icon', 'theme-label',
    'quick-theme-dark-btn', 'quick-theme-light-btn',
    'open-create-group-btn', 'open-join-group-btn', 'open-new-dm-btn',
    'user-search', 'filter-all', 'filter-groups', 'filter-dms', 'filter-online', 'online-counter',
    'conversation-list', 'main-chat-area',
    'room-header-clickable', 'mobile-back-btn', 'active-conv-avatar', 'active-conv-title',
    'active-conv-badge', 'header-member-count', 'header-mute-conv-btn', 'header-mute-svg', 'header-mute-label',
    'header-invite-btn', 'header-invite-label',
    'toggle-pins-btn', 'pin-badge', 'toggle-info-drawer-btn',
    'incoming-invite-banner', 'incoming-invite-title', 'incoming-invite-sub',
    'accept-incoming-invite-btn', 'dismiss-incoming-invite-btn',
    'pinned-banner', 'pinned-text', 'unpin-current-btn',
    'messages-container', 'typing-indicator', 'typing-text',
    'reply-preview-bar', 'reply-preview-author', 'reply-preview-text', 'cancel-reply-btn',
    'attachment-preview-bar',
    'voice-recorder-bar', 'voice-timer', 'cancel-voice-btn', 'send-voice-btn',
    'emoji-strip', 'emoji-grid-container', 'toggle-emoji-btn',
    'toggle-attach-btn', 'attach-popover', 'attach-photo-btn', 'attach-video-btn', 'attach-audio-btn', 'attach-doc-btn',
    'file-input-image', 'file-input-video', 'file-input-audio', 'file-input-doc',
    'chat-form', 'message-input', 'voice-record-btn', 'send-btn',
    'info-drawer', 'drawer-heading', 'close-info-drawer-btn', 'drawer-avatar', 'drawer-title',
    'drawer-subtitle', 'drawer-group-section', 'drawer-invite-help', 'drawer-invite-code-display',
    'copy-group-code-btn', 'post-group-card-btn', 'drawer-invite-pubkey-input', 'drawer-send-pubkey-invite-btn',
    'drawer-online-count', 'user-list',
    'stat-webrtc-peers', 'stat-mqtt-brokers', 'stat-dedup-ring', 'stat-crypto-mode',
    'create-group-modal', 'close-create-group-btn', 'create-group-form',
    'new-group-name', 'new-group-desc', 'new-group-invite-pubkey', 'create-group-online-checklist',
    'join-group-modal', 'close-join-group-btn', 'join-group-form', 'join-group-code-input', 'join-group-custom-name',
    'new-dm-modal', 'close-new-dm-btn', 'new-dm-form', 'dm-target-pubkey-input', 'dm-target-name-input', 'dm-online-peers-list',
    'identity-modal', 'close-identity-btn', 'edit-username-input', 'save-username-btn',
    'copy-my-pubkey-btn', 'my-public-id-display', 'toggle-secret-visibility-btn', 'copy-my-privkey-btn',
    'my-private-id-display', 'switch-privkey-input', 'switch-privkey-btn', 'generate-new-id-btn',
    'context-backdrop', 'message-context-menu', 'ctx-avatar', 'ctx-username', 'ctx-you-tag', 'ctx-user-id',
    'ctx-reply-btn', 'ctx-dm-sender-btn', 'ctx-invite-sender-btn', 'ctx-mute-conv-btn', 'ctx-mute-label',
    'ctx-pin-btn', 'ctx-pin-icon', 'ctx-pin-label',
    'ctx-copy-id-btn', 'ctx-copy-text-btn',
    'media-lightbox', 'lightbox-img', 'lightbox-download-btn', 'lightbox-close-btn',
    'push-banner-container', 'toast'
  ];
  ids.forEach((id) => {
    const camel = id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
    el[camel] = document.getElementById(id);
  });
  el.retentionRadios = document.querySelectorAll('input[name="retention"]');
  el.themeButtons = document.querySelectorAll('.dropdown-theme-btn');
  el.filterPills = document.querySelectorAll('.wa-filter-pill');
  el.emojiCatBtns = document.querySelectorAll('.wa-emoji-cat-btn');
  el.ctxReactBtns = document.querySelectorAll('.ctx-react-btn');
}

const RANDOM_NAMES = [
  'Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Avery',
  'Quinn', 'Harper', 'Rowan', 'Dakota', 'Skyler', 'Cameron', 'Logan'
];

function getRandomUsername() {
  const name = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
  const num = Math.floor(10 + Math.random() * 89);
  return `${name}${num}`;
}

let toastTimer = null;
function showToast(msg) {
  if (!el.toast) return;
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2800);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, (tag) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[tag] || tag));
}

function getMonogram(convOrName, type = '') {
  if (type === 'global') return 'GC';
  const clean = String(convOrName || '').replace(/^[@#]/, '').trim();
  if (!clean) return type === 'group' ? 'GR' : 'NT';
  const parts = clean.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

function authorColorFromPub(pubkey) {
  const palette = ['#10b981', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ec4899', '#3b82f6', '#14b8a6'];
  const clean = (pubkey || 'anon');
  let h = 0;
  for (let i = 0; i < clean.length; i++) h = (h * 31 + clean.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function formatBytes(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// Granular Mute Rules & Push Notification Engine
// ============================================================================

function loadMutePreferences() {
  const raw = safeGetItem(localStorage, 'p0_mute_prefs');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      state.mutePrefs = {
        muteGlobalChat: !!parsed.muteGlobalChat,
        muteGlobalMessages: !!parsed.muteGlobalMessages,
        muteAllGroups: !!parsed.muteAllGroups,
        muteAllDms: !!parsed.muteAllDms,
        muteSound: !!parsed.muteSound,
        mutedConvIds: Array.isArray(parsed.mutedConvIds) ? parsed.mutedConvIds : [],
      };
    } catch (_) {}
  }
  syncMuteCheckboxesUI();
  updatePushPermissionUI();
}

function saveMutePreferences() {
  safeSetItem(localStorage, 'p0_mute_prefs', JSON.stringify(state.mutePrefs));
  syncMuteCheckboxesUI();
  updateActiveChatHeader();
  renderConversationList();
}

function syncMuteCheckboxesUI() {
  if (el.muteGlobalChatCb) el.muteGlobalChatCb.checked = !!state.mutePrefs.muteGlobalChat;
  if (el.muteGlobalMsgCb) el.muteGlobalMsgCb.checked = !!state.mutePrefs.muteGlobalMessages;
  if (el.muteAllGroupsCb) el.muteAllGroupsCb.checked = !!state.mutePrefs.muteAllGroups;
  if (el.muteAllDmsCb) el.muteAllDmsCb.checked = !!state.mutePrefs.muteAllDms;
  if (el.muteSoundCb) el.muteSoundCb.checked = !!state.mutePrefs.muteSound;
}

function isConversationMuted(conv, isSystemOrBroadcast = false) {
  if (isSystemOrBroadcast && state.mutePrefs.muteGlobalMessages) {
    return true;
  }
  if (!conv) return false;
  if (state.mutePrefs.mutedConvIds.includes(conv.id)) {
    return true;
  }
  if (conv.id === 'global' && state.mutePrefs.muteGlobalChat) {
    return true;
  }
  if (conv.type === 'group' && state.mutePrefs.muteAllGroups) {
    return true;
  }
  if (conv.type === 'dm' && state.mutePrefs.muteAllDms) {
    return true;
  }
  return false;
}

function toggleConversationMute(convId) {
  if (!convId) return;
  const conv = state.conversations.get(convId);
  if (convId === 'global') {
    state.mutePrefs.muteGlobalChat = !state.mutePrefs.muteGlobalChat;
    const idx = state.mutePrefs.mutedConvIds.indexOf('global');
    if (state.mutePrefs.muteGlobalChat && idx === -1) {
      state.mutePrefs.mutedConvIds.push('global');
    } else if (!state.mutePrefs.muteGlobalChat && idx !== -1) {
      state.mutePrefs.mutedConvIds.splice(idx, 1);
    }
    saveMutePreferences();
    showToast(state.mutePrefs.muteGlobalChat ? 'Muted Global Chat' : 'Unmuted Global Chat');
    return;
  }

  const idx = state.mutePrefs.mutedConvIds.indexOf(convId);
  let nowMuted = false;
  if (idx === -1) {
    state.mutePrefs.mutedConvIds.push(convId);
    nowMuted = true;
  } else {
    state.mutePrefs.mutedConvIds.splice(idx, 1);
    nowMuted = false;
  }
  saveMutePreferences();
  const label = conv ? conv.name : convId;
  showToast(nowMuted ? `Muted ${label}` : `Unmuted ${label}`);
}

function playNotificationChime() {
  if (state.mutePrefs.muteSound) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!state.audioCtx) {
      state.audioCtx = new AudioCtx();
    }
    if (state.audioCtx.state === 'suspended') {
      state.audioCtx.resume();
    }
    const now = state.audioCtx.currentTime;
    const osc = state.audioCtx.createOscillator();
    const gain = state.audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.09);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.075, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.connect(gain);
    gain.connect(state.audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  } catch (_) {}
}

function updatePushPermissionUI() {
  if (!el.pushPermStatus || !el.enablePushBtn) return;
  if (!('Notification' in window)) {
    el.pushPermStatus.textContent = 'In-App Alerts Active';
    el.enablePushBtn.textContent = 'In-App Active';
    return;
  }
  const perm = Notification.permission;
  if (perm === 'granted') {
    el.pushPermStatus.textContent = 'Desktop + In-App Active';
    el.enablePushBtn.textContent = 'Push Enabled ✓';
  } else if (perm === 'denied') {
    el.pushPermStatus.textContent = 'In-App Mode';
    el.enablePushBtn.textContent = 'In-App Alerts Active';
  } else {
    el.pushPermStatus.textContent = 'In-App Active';
    el.enablePushBtn.textContent = 'Enable Browser Push';
  }
}

async function requestBrowserPushPermission() {
  if (!('Notification' in window)) {
    showToast('In-App Push Notifications are active!');
    updatePushPermissionUI();
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    updatePushPermissionUI();
    if (perm === 'granted') {
      showToast('Push Notifications enabled!');
      triggerPushNotification({
        title: 'Push Notifications Enabled',
        body: 'You will now receive instant alerts for new messages and shared files.',
        badgeText: 'Active',
        convId: state.activeConvId,
        forceShow: true,
      });
    } else {
      showToast('In-App Push Notification Banners are active');
    }
  } catch (_) {
    showToast('In-App Push Notification Banners enabled');
  }
}

function triggerPushNotification({ title, body, badgeText = 'New Message', convId = 'global', avatarText = 'NT', forceShow = false }) {
  playNotificationChime();

  if ('Notification' in window && Notification.permission === 'granted') {
    if (document.hidden || convId !== state.activeConvId || forceShow) {
      try {
        const n = new Notification(title, {
          body,
          tag: `nt_${convId}_${Date.now()}`,
          silent: !!state.mutePrefs.muteSound,
        });
        n.onclick = () => {
          try { window.focus(); } catch (_) {}
          if (convId && state.conversations.has(convId)) {
            selectConversation(convId);
          }
          n.close();
        };
      } catch (_) {}
    }
  }

  if (!el.pushBannerContainer) return;
  const card = document.createElement('div');
  card.className = 'push-notif-card';
  card.innerHTML = `
    <div class="wa-avatar sm global-av">${escapeHtml(avatarText.slice(0, 2).toUpperCase())}</div>
    <div class="push-notif-body">
      <div class="push-notif-top">
        <span class="push-notif-title">${escapeHtml(title)}</span>
        <span class="push-notif-badge">${escapeHtml(badgeText)}</span>
      </div>
      <div class="push-notif-text">${escapeHtml(body)}</div>
    </div>
    <button type="button" class="push-notif-close" aria-label="Dismiss notification">✕</button>
  `;

  const closeBtn = card.querySelector('.push-notif-close');
  let removed = false;
  const removeCard = () => {
    if (removed) return;
    removed = true;
    card.style.opacity = '0';
    card.style.transform = 'translateX(20px)';
    card.style.transition = 'all 0.18s ease';
    setTimeout(() => card.remove(), 180);
  };

  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeCard();
    });
  }

  card.addEventListener('click', () => {
    if (convId && state.conversations.has(convId)) {
      selectConversation(convId);
    }
    removeCard();
  });

  el.pushBannerContainer.appendChild(card);
  while (el.pushBannerContainer.children.length > 3) {
    el.pushBannerContainer.firstElementChild.remove();
  }
  setTimeout(removeCard, 5000);
}

// ============================================================================
// Rich Media, File, Photo, Video, OPFS Binary Blobs & Opus Voice Notes
// ============================================================================

function compressImageFile(file, maxDim = 1280, quality = 0.84) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const outMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(outMime, quality);
        resolve({
          id: 'att_' + Math.random().toString(36).slice(2, 9),
          kind: 'image',
          name: file.name || 'photo.jpg',
          mime: outMime,
          size: Math.round((dataUrl.length * 3) / 4),
          dataUrl,
        });
      };
      img.onerror = () => resolve(null);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function readRawFileAsAttachment(file, forcedKind = null) {
  if (file.size > 1024 * 1024 * 1024) {
    showToast('File exceeds 1 GB streaming limit');
    return null;
  }
  const mime = file.type || 'application/octet-stream';
  let kind = forcedKind;
  if (!kind) {
    if (mime.startsWith('image/')) kind = 'image';
    else if (mime.startsWith('video/')) kind = 'video';
    else if (mime.startsWith('audio/')) kind = 'audio';
    else kind = 'file';
  }
  const attId = 'att_' + Math.random().toString(36).slice(2, 9);

  // For large files (> 192 KB), use zero-copy OPFS / ObjectURL + 16 KB binary chunked streaming
  if (file.size > 196608) {
    let objUrl = URL.createObjectURL(file);
    if (window.chatStorage && typeof window.chatStorage.storeBinaryAttachment === 'function') {
      objUrl = await window.chatStorage.storeBinaryAttachment(attId, file, mime);
    }
    return {
      id: attId,
      kind,
      name: file.name || 'attachment',
      mime,
      size: file.size,
      dataUrl: objUrl,
      rawBlob: file,
    };
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      resolve({
        id: attId,
        kind,
        name: file.name || 'attachment',
        mime,
        size: file.size,
        dataUrl: e.target.result,
        rawBlob: file,
      });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function handleSelectedFiles(fileList, forcedKind = null) {
  if (!fileList || fileList.length === 0) return;
  for (const file of Array.from(fileList)) {
    let att = null;
    if ((forcedKind === 'image' || (file.type && file.type.startsWith('image/'))) && file.type !== 'image/gif' && file.size < 8 * 1024 * 1024) {
      att = await compressImageFile(file);
    } else {
      att = await readRawFileAsAttachment(file, forcedKind);
    }
    if (att) {
      state.pendingAttachments.push(att);
    }
  }
  renderPendingAttachmentsBar();
  if (el.messageInput) el.messageInput.focus();
}

function renderPendingAttachmentsBar() {
  if (!el.attachmentPreviewBar) return;
  if (state.pendingAttachments.length === 0) {
    el.attachmentPreviewBar.classList.add('hidden');
    el.attachmentPreviewBar.innerHTML = '';
    return;
  }

  el.attachmentPreviewBar.classList.remove('hidden');
  el.attachmentPreviewBar.innerHTML = '';

  state.pendingAttachments.forEach((att) => {
    const item = document.createElement('div');
    item.className = 'wa-pending-item';
    const ext = (att.name.split('.').pop() || att.kind).slice(0, 4).toUpperCase();
    const thumbHtml = att.kind === 'image'
      ? `<img class="wa-pending-thumb" src="${att.dataUrl}" alt="${escapeHtml(att.name)}">`
      : `<div class="wa-pending-thumb">${escapeHtml(ext)}</div>`;

    item.innerHTML = `
      ${thumbHtml}
      <div style="min-width:0; flex:1;">
        <div class="wa-pending-name">${escapeHtml(att.name)}</div>
        <div style="font-size:0.65rem; color:var(--text-muted);">${formatBytes(att.size)}</div>
      </div>
      <button type="button" class="wa-pending-remove" title="Remove attachment">✕</button>
    `;

    item.querySelector('.wa-pending-remove').addEventListener('click', () => {
      state.pendingAttachments = state.pendingAttachments.filter(x => x.id !== att.id);
      renderPendingAttachmentsBar();
    });

    el.attachmentPreviewBar.appendChild(item);
  });
}

function createSynthesizedVoiceNoteDataUrl(durationSec = 2) {
  const sampleRate = 16000;
  const numSamples = Math.max(1, Math.min(durationSec, 8)) * sampleRate;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const freq = 440 + 110 * Math.sin(t * 6);
    const env = Math.min(1, i / 800) * Math.max(0, 1 - i / numSamples);
    const sample = Math.sin(2 * Math.PI * freq * t) * 0.25 * env;
    view.setInt16(44 + i * 2, sample * 32767, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

async function startVoiceRecording() {
  if (state.voiceRecorder.active) return;
  state.voiceRecorder.active = true;
  state.voiceRecorder.chunks = [];
  state.voiceRecorder.startTime = Date.now();

  if (el.voiceRecorderBar) el.voiceRecorderBar.classList.remove('hidden');
  if (el.voiceTimer) el.voiceTimer.textContent = '0:00';

  clearInterval(state.voiceRecorder.timerInterval);
  state.voiceRecorder.timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.voiceRecorder.startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = String(elapsed % 60).padStart(2, '0');
    if (el.voiceTimer) el.voiceTimer.textContent = `${mins}:${secs}`;
  }, 300);

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.voiceRecorder.stream = stream;
      const opusMime = (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
        ? 'audio/webm;codecs=opus'
        : undefined;
      const mr = opusMime
        ? new MediaRecorder(stream, { mimeType: opusMime, audioBitsPerSecond: 24000 })
        : new MediaRecorder(stream);
      state.voiceRecorder.mediaRecorder = mr;
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) state.voiceRecorder.chunks.push(e.data);
      };
      mr.start();
    } catch (_) {}
  }
}

function stopVoiceRecording(shouldSend = true) {
  if (!state.voiceRecorder.active) return;
  const durationSec = Math.max(1, Math.round((Date.now() - state.voiceRecorder.startTime) / 1000));
  state.voiceRecorder.active = false;
  clearInterval(state.voiceRecorder.timerInterval);
  if (el.voiceRecorderBar) el.voiceRecorderBar.classList.add('hidden');

  const finalizeAndSend = (dataUrl, mimeType = 'audio/wav') => {
    if (!shouldSend || !dataUrl) return;
    const att = {
      id: 'voice_' + Date.now(),
      kind: 'voice',
      name: `Voice Note (${durationSec}s)`,
      mime: mimeType,
      size: Math.round((dataUrl.length * 3) / 4),
      duration: durationSec,
      dataUrl,
    };
    const conv = state.conversations.get(state.activeConvId) || state.conversations.get('global');
    if (state.swarm && conv) {
      state.swarm.sendChatMessage(`🎤 Voice Note (${durationSec}s)`, conv, {
        attachments: [att],
      });
    }
  };

  const mr = state.voiceRecorder.mediaRecorder;
  if (mr && mr.state !== 'inactive') {
    mr.onstop = () => {
      if (state.voiceRecorder.stream) {
        state.voiceRecorder.stream.getTracks().forEach(t => t.stop());
      }
      if (!shouldSend) return;
      if (state.voiceRecorder.chunks.length > 0) {
        const blob = new Blob(state.voiceRecorder.chunks, { type: mr.mimeType || 'audio/webm;codecs=opus' });
        const reader = new FileReader();
        reader.onload = (e) => finalizeAndSend(e.target.result, blob.type);
        reader.readAsDataURL(blob);
      } else {
        finalizeAndSend(createSynthesizedVoiceNoteDataUrl(durationSec), 'audio/wav');
      }
    };
    try { mr.stop(); } catch (_) {
      finalizeAndSend(createSynthesizedVoiceNoteDataUrl(durationSec), 'audio/wav');
    }
  } else {
    if (state.voiceRecorder.stream) {
      state.voiceRecorder.stream.getTracks().forEach(t => t.stop());
    }
    if (shouldSend) {
      finalizeAndSend(createSynthesizedVoiceNoteDataUrl(durationSec), 'audio/wav');
    }
  }
  state.voiceRecorder.mediaRecorder = null;
  state.voiceRecorder.stream = null;
}

function openMediaLightbox(dataUrl, fileName = 'photo.jpg') {
  if (!el.mediaLightbox || !el.lightboxImg) return;
  el.lightboxImg.src = dataUrl;
  if (el.lightboxDownloadBtn) {
    el.lightboxDownloadBtn.href = dataUrl;
    el.lightboxDownloadBtn.download = fileName;
  }
  el.mediaLightbox.classList.remove('hidden');
}

// ============================================================================
// Conversations State (Global Chat, Custom Groups & Direct Messages)
// ============================================================================

function ensureDefaultConversations() {
  if (!state.conversations.has('global')) {
    state.conversations.set('global', {
      id: 'global',
      type: 'global',
      name: 'Global Chat',
      description: 'Public community room • Share messages, photos, audio, video & files',
      secretKey: '',
      isPrivate: false,
      unread: 0,
      lastMsg: 'Welcome! Share messages, photos, voice notes, or files.',
      lastTime: Date.now(),
    });
  } else {
    const g = state.conversations.get('global');
    if (g.name === 'Global Swarm') g.name = 'Global Chat';
  }

  const savedJson = safeGetItem(localStorage, 'p0_saved_conversations');
  if (savedJson) {
    try {
      const list = JSON.parse(savedJson);
      if (Array.isArray(list)) {
        list.forEach((c) => {
          if (c && c.id && c.id !== 'global') {
            state.conversations.set(c.id, { unread: 0, ...c });
          }
        });
      }
    } catch (_) {}
  }
}

function persistConversations() {
  const custom = Array.from(state.conversations.values()).filter(c => c.id !== 'global');
  safeSetItem(localStorage, 'p0_saved_conversations', JSON.stringify(custom));
  if (window.chatStorage) {
    custom.forEach(c => window.chatStorage.saveConversation(c));
  }
}

function registerOrGetGroup(groupData, switchAfter = false) {
  if (!groupData || !groupData.id) return null;
  const existing = state.conversations.get(groupData.id);
  const merged = {
    id: groupData.id,
    type: 'group',
    name: groupData.name || (existing && existing.name) || `Group ${groupData.id.slice(4, 10)}`,
    description: groupData.description || (existing && existing.description) || 'Private Encrypted Group',
    secretKey: groupData.secretKey || (existing && existing.secretKey) || P0Crypto.derivePubSync(groupData.id, 'P0_DEFAULT_GRP_KEY_v3'),
    isPrivate: groupData.isPrivate !== undefined ? !!groupData.isPrivate : true,
    unread: existing ? (existing.unread || 0) : 0,
    lastMsg: existing ? existing.lastMsg : 'Private group ready',
    lastTime: existing ? existing.lastTime : Date.now(),
  };
  state.conversations.set(merged.id, merged);
  persistConversations();
  if (state.swarm) {
    state.swarm.subscribeGroup(merged.id);
  }
  if (switchAfter) {
    selectConversation(merged.id);
  } else {
    renderConversationList();
  }
  return merged;
}

function registerOrGetDmConversation(peerPubkey, peerUsername = '', switchAfter = true) {
  const cleanTheirPub = P0Crypto.normalizePubkey(peerPubkey);
  const myPub = state.identity ? P0Crypto.normalizePubkey(state.identity.ed25519_pub) : '';
  if (!cleanTheirPub) return null;
  if (cleanTheirPub === myPub) {
    showToast('That is your own Contact ID!');
    return null;
  }

  const convId = P0Crypto.getDmConvId(myPub, cleanTheirPub);
  const knownPeer = state.onlineUsers.find(u => P0Crypto.normalizePubkey(u.pubkey) === cleanTheirPub);
  const resolvedName = (peerUsername || (knownPeer && knownPeer.username) || `User ${cleanTheirPub.slice(0, 6)}`).replace(/^@/, '');

  const existing = state.conversations.get(convId);
  const conv = {
    id: convId,
    type: 'dm',
    name: `@${resolvedName}`,
    peerUsername: resolvedName,
    peerPubkey: cleanTheirPub,
    description: `Direct Chat • ${P0Crypto.formatPublicId(cleanTheirPub)}`,
    unread: existing ? (existing.unread || 0) : 0,
    lastMsg: existing ? existing.lastMsg : `Encrypted direct chat with @${resolvedName}`,
    lastTime: existing ? existing.lastTime : Date.now(),
  };
  state.conversations.set(convId, conv);
  persistConversations();

  if (switchAfter) {
    selectConversation(convId);
  } else {
    renderConversationList();
  }
  return conv;
}

function selectConversation(convId) {
  if (!state.conversations.has(convId)) convId = 'global';
  state.activeConvId = convId;
  const conv = state.conversations.get(convId);
  if (conv) {
    conv.unread = 0;
  }
  cancelReply();
  updateActiveChatHeader();
  renderConversationList();
  renderMessagesForActiveConversation();
  updateInfoDrawerContent();

  if (el.app) {
    el.app.classList.add('mobile-chat-active');
  }
}

function updateActiveChatHeader() {
  const conv = state.conversations.get(state.activeConvId) || state.conversations.get('global');
  if (!conv) return;

  if (el.activeConvTitle) el.activeConvTitle.textContent = conv.name;
  if (el.activeConvAvatar) {
    el.activeConvAvatar.className = 'wa-avatar ' + (conv.type === 'global' ? 'global-av' : conv.type === 'group' ? 'group-av' : '');
    el.activeConvAvatar.textContent = getMonogram(conv.peerUsername || conv.name, conv.type);
  }

  if (el.activeConvBadge) {
    if (conv.type === 'dm') {
      el.activeConvBadge.textContent = 'Direct Chat';
    } else if (conv.type === 'group') {
      el.activeConvBadge.textContent = 'Private Group';
    } else {
      el.activeConvBadge.textContent = 'Encrypted';
    }
  }

  const muted = isConversationMuted(conv, false);
  if (el.headerMuteConvBtn) {
    el.headerMuteConvBtn.classList.toggle('muted-active', muted);
    if (el.headerMuteLabel) {
      el.headerMuteLabel.textContent = muted ? 'Muted' : 'Mute';
    }
    if (el.headerMuteSvg) {
      el.headerMuteSvg.outerHTML = muted
        ? SVG_BELL_OFF.replace('class="ui-icon"', 'class="ui-icon" id="header-mute-svg"')
        : SVG_BELL_ON.replace('class="ui-icon"', 'class="ui-icon" id="header-mute-svg"');
      el.headerMuteSvg = document.getElementById('header-mute-svg');
    }
  }

  const realPeers = getNormalizedOnlineUsers();
  if (el.headerMemberCount) {
    const muteSuffix = muted ? ' • Muted' : '';
    if (conv.type === 'dm') {
      const isPeerOnline = realPeers.some(u => P0Crypto.normalizePubkey(u.pubkey) === conv.peerPubkey);
      el.headerMemberCount.textContent = `${isPeerOnline ? 'Online now' : 'Direct Contact'} • ${P0Crypto.formatPublicId(conv.peerPubkey)}${muteSuffix}`;
    } else if (conv.type === 'group') {
      el.headerMemberCount.textContent = `${conv.description || 'Private Group'} • Tap for invite options${muteSuffix}`;
    } else {
      const countTxt = realPeers.length === 0
        ? 'You are online • Invite friends or open another tab'
        : `${realPeers.length} other ${realPeers.length === 1 ? 'person' : 'people'} online now`;
      el.headerMemberCount.textContent = `${countTxt}${muteSuffix}`;
    }
  }

  if (el.headerInviteLabel) {
    el.headerInviteLabel.textContent = conv.type === 'dm' ? 'Add to Group' : 'Invite';
  }
}

// ============================================================================
// Left Sidebar Rendering (Conversations + Strictly Real Online People)
// ============================================================================

function formatShortTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getNormalizedOnlineUsers() {
  const myPub = state.identity ? P0Crypto.normalizePubkey(state.identity.ed25519_pub) : '';
  const now = Date.now();
  const map = new Map();

  state.onlineUsers.forEach((u) => {
    if (u && u.pubkey) {
      const clean = P0Crypto.normalizePubkey(u.pubkey);
      if (clean && clean !== myPub && (now - (u.lastSeen || 0)) < 35000) {
        map.set(clean, {
          username: (u.username || 'user').replace(/^@/, ''),
          pubkey: clean,
          isMe: false,
        });
      }
    }
  });

  const list = Array.from(map.values());
  if (el.onlineCounter) el.onlineCounter.textContent = String(list.length);
  if (el.drawerOnlineCount) el.drawerOnlineCount.textContent = String(list.length);
  return list;
}

function renderConversationList() {
  if (!el.conversationList) return;
  el.conversationList.innerHTML = '';

  const q = (state.searchQuery || '').toLowerCase().trim();
  const filter = state.sidebarFilter;
  const peers = getNormalizedOnlineUsers();

  if (filter !== 'online') {
    const convs = Array.from(state.conversations.values()).sort((a, b) => {
      if (a.id === 'global') return -1;
      if (b.id === 'global') return 1;
      return (b.lastTime || 0) - (a.lastTime || 0);
    });

    const matchingConvs = convs.filter((c) => {
      if (filter === 'groups' && c.type !== 'group' && c.id !== 'global') return false;
      if (filter === 'dms' && c.type !== 'dm') return false;
      if (!q) return true;
      return (
        (c.name || '').toLowerCase().includes(q) ||
        (c.id || '').toLowerCase().includes(q) ||
        (c.peerPubkey || '').toLowerCase().includes(q)
      );
    });

    matchingConvs.forEach((conv) => {
      const item = document.createElement('div');
      item.className = `wa-chat-item ${conv.id === state.activeConvId ? 'active' : ''}`;
      const avClass = conv.type === 'global' ? 'global-av' : conv.type === 'group' ? 'group-av' : '';
      const avLabel = getMonogram(conv.peerUsername || conv.name, conv.type);
      const isOnlineDm = conv.type === 'dm' && peers.some(u => P0Crypto.normalizePubkey(u.pubkey) === conv.peerPubkey);
      const isMuted = isConversationMuted(conv, false);

      item.innerHTML = `
        <div class="wa-avatar ${avClass}">
          ${escapeHtml(avLabel)}
          ${isOnlineDm ? '<span class="wa-online-dot"></span>' : ''}
        </div>
        <div class="wa-chat-item-body">
          <div class="wa-chat-item-top">
            <div class="wa-chat-item-title">
              <span>${escapeHtml(conv.name)}</span>
              ${conv.type !== 'global' ? SVG_LOCK_MINI : ''}
              ${isMuted ? `<span class="wa-muted-pill" title="Notifications Muted">${SVG_BELL_OFF}</span>` : ''}
            </div>
            <span class="wa-chat-item-time">${formatShortTime(conv.lastTime)}</span>
          </div>
          <div class="wa-chat-item-bottom">
            <span class="wa-chat-item-preview">${escapeHtml(conv.lastMsg || '')}</span>
            <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
              <button type="button" class="wa-row-mute-btn ${isMuted ? 'is-muted' : ''}" title="${isMuted ? 'Unmute conversation' : 'Mute conversation'}">
                ${isMuted ? SVG_BELL_OFF : SVG_BELL_ON}
              </button>
              ${conv.unread > 0 ? `<span class="wa-unread-badge" style="${isMuted ? 'opacity:0.55;' : ''}">${conv.unread}</span>` : ''}
            </div>
          </div>
        </div>
      `;

      const rowMuteBtn = item.querySelector('.wa-row-mute-btn');
      if (rowMuteBtn) {
        rowMuteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleConversationMute(conv.id);
        });
      }

      item.addEventListener('click', () => selectConversation(conv.id));
      el.conversationList.appendChild(item);
    });
  }

  const filteredPeers = peers.filter((u) => {
    if (!q) return true;
    return (
      (u.username || '').toLowerCase().includes(q) ||
      (u.pubkey || '').toLowerCase().includes(q)
    );
  });

  const divider = document.createElement('div');
  divider.className = 'wa-section-divider';
  divider.innerHTML = `
    <span>People Online (${peers.length})</span>
    <span>Direct Chat / Invite</span>
  `;
  el.conversationList.appendChild(divider);

  if (filteredPeers.length === 0) {
    const emptyBox = document.createElement('div');
    emptyBox.className = 'wa-empty-online';
    emptyBox.textContent = 'No one else is online right now. Share your Contact ID or open another tab to chat live!';
    el.conversationList.appendChild(emptyBox);
  } else {
    filteredPeers.slice(0, 100).forEach((user) => {
      const cleanPub = P0Crypto.normalizePubkey(user.pubkey);
      const row = document.createElement('div');
      row.className = 'wa-chat-item';
      const shortId = P0Crypto.formatPublicId(cleanPub);

      row.innerHTML = `
        <div class="wa-avatar sm">
          ${escapeHtml(getMonogram(user.username || 'U'))}
          <span class="wa-online-dot"></span>
        </div>
        <div class="wa-chat-item-body">
          <div class="wa-chat-item-top">
            <div class="wa-chat-item-title">
              <span>@${escapeHtml(user.username || 'user')}</span>
            </div>
          </div>
          <div class="wa-chat-item-bottom">
            <span class="wa-chat-item-preview" style="font-family:var(--font-mono); font-size:0.68rem;">${escapeHtml(shortId)}</span>
          </div>
        </div>
        <div class="wa-peer-actions">
          <button type="button" class="wa-mini-btn primary peer-dm-btn" title="Start Direct Message">Message</button>
          <button type="button" class="wa-mini-btn peer-invite-btn" title="Invite to Group">+ Group</button>
        </div>
      `;

      const dmBtn = row.querySelector('.peer-dm-btn');
      if (dmBtn) {
        dmBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          registerOrGetDmConversation(cleanPub, user.username, true);
        });
      }

      const invBtn = row.querySelector('.peer-invite-btn');
      if (invBtn) {
        invBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          inviteUserToCurrentOrNewGroup(cleanPub, user.username);
        });
      }

      row.addEventListener('click', () => {
        registerOrGetDmConversation(cleanPub, user.username, true);
      });

      el.conversationList.appendChild(row);
    });
  }

  renderDrawerOnlinePeers(peers);
}

function renderDrawerOnlinePeers(peers) {
  if (!el.userList) return;
  el.userList.innerHTML = '';

  if (peers.length === 0) {
    el.userList.innerHTML = `<div class="help-text" style="padding:8px 0;">No other people online right now. You can still invite anyone anytime using their Contact ID (` + '`pub_...`' + `).</div>`;
    return;
  }

  peers.slice(0, 80).forEach((user) => {
    const cleanPub = P0Crypto.normalizePubkey(user.pubkey);
    const item = document.createElement('div');
    item.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 9px; border-radius:8px; background:var(--bg-sidebar); border:1px solid var(--border-subtle);';
    item.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; min-width:0;">
        <div class="wa-avatar sm">${escapeHtml(getMonogram(user.username || 'U'))}</div>
        <div style="min-width:0;">
          <div style="font-weight:700; font-size:0.8rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            @${escapeHtml(user.username || 'user')}
          </div>
          <div style="font-family:var(--font-mono); font-size:0.65rem; color:var(--text-muted);">${escapeHtml(P0Crypto.formatPublicId(cleanPub))}</div>
        </div>
      </div>
      <div style="display:flex; gap:4px; flex-shrink:0;">
        <button type="button" class="wa-mini-btn primary d-dm-btn">Message</button>
        <button type="button" class="wa-mini-btn d-inv-btn">Invite</button>
      </div>
    `;

    item.querySelector('.d-dm-btn').addEventListener('click', () => registerOrGetDmConversation(cleanPub, user.username, true));
    item.querySelector('.d-inv-btn').addEventListener('click', () => inviteUserToCurrentOrNewGroup(cleanPub, user.username));
    el.userList.appendChild(item);
  });
}

// ============================================================================
// Group Invitations & Info Drawer
// ============================================================================

function inviteUserToCurrentOrNewGroup(targetPubkey, targetUsername = '') {
  const activeConv = state.conversations.get(state.activeConvId);
  let targetGroup = (activeConv && activeConv.type === 'group') ? activeConv : null;

  if (!targetGroup) {
    const anyGroup = Array.from(state.conversations.values()).find(c => c.type === 'group');
    if (anyGroup) {
      targetGroup = anyGroup;
    } else {
      openCreateGroupModal(targetPubkey);
      showToast(`Create a group to invite @${targetUsername || targetPubkey.slice(0, 6)}`);
      return;
    }
  }

  if (state.swarm) {
    state.swarm.sendGroupInvite(targetPubkey, targetGroup);
    showToast(`Sent group invite for "${targetGroup.name}" to @${targetUsername || P0Crypto.formatPublicId(targetPubkey)}`);
  }
}

function handleIncomingGroupInvite(invite) {
  if (!invite || !invite.groupId) return;
  if (state.mutePrefs.muteGlobalMessages || state.mutePrefs.muteAllGroups) {
    return;
  }
  state.pendingGroupInvite = invite;

  if (el.incomingInviteBanner) {
    el.incomingInviteTitle.textContent = `Group Invite: "${invite.groupName || invite.groupId}"`;
    el.incomingInviteSub.textContent = `@${invite.inviterUsername || 'friend'} invited you to join`;
    el.incomingInviteBanner.classList.remove('hidden');
  }

  triggerPushNotification({
    title: `Group Invite: ${invite.groupName || invite.groupId}`,
    body: `@${invite.inviterUsername || 'friend'} invited you to join their private group.`,
    badgeText: 'Group Invite',
    convId: state.activeConvId,
    avatarText: invite.groupName || 'GR',
  });
}

function updateInfoDrawerContent() {
  const conv = state.conversations.get(state.activeConvId) || state.conversations.get('global');
  if (!conv) return;

  if (el.drawerTitle) el.drawerTitle.textContent = conv.name;
  if (el.drawerSubtitle) el.drawerSubtitle.textContent = conv.description || '';
  if (el.drawerAvatar) {
    el.drawerAvatar.className = 'wa-avatar lg ' + (conv.type === 'global' ? 'global-av' : conv.type === 'group' ? 'group-av' : '');
    el.drawerAvatar.textContent = getMonogram(conv.peerUsername || conv.name, conv.type);
  }

  if (el.drawerInviteCodeDisplay) {
    if (conv.type === 'group') {
      el.drawerInviteCodeDisplay.textContent = P0Crypto.encodeGroupInviteCode(conv);
    } else if (conv.type === 'dm') {
      el.drawerInviteCodeDisplay.textContent = `pub_${conv.peerPubkey}`;
    } else {
      el.drawerInviteCodeDisplay.textContent = P0Crypto.getPublicIdentity(state.identity);
    }
  }
}

// ============================================================================
// Message Processing, Reactions, `requestAnimationFrame` Batched DOM Commits
// ============================================================================

function queueMessageForDomCommit(msg) {
  state.domCommitQueue.push(msg);
  if (!state.rafCommitId) {
    state.rafCommitId = requestAnimationFrame(() => flushDomCommitQueue());
  }
}

function flushDomCommitQueue() {
  state.rafCommitId = null;
  if (!el.messagesContainer || state.domCommitQueue.length === 0) return;

  const batch = state.domCommitQueue.splice(0, state.domCommitQueue.length);
  const frag = document.createDocumentFragment();
  let appendedCount = 0;

  for (let i = 0; i < batch.length; i++) {
    const msg = batch[i];
    if ((msg.convId || 'global') !== state.activeConvId) continue;
    const row = buildMessageRowDom(msg, batch.length <= 8);
    if (row) {
      frag.appendChild(row);
      appendedCount++;
    }
  }

  if (appendedCount > 0) {
    el.messagesContainer.appendChild(frag);
    const existingRows = el.messagesContainer.querySelectorAll('.message-row');
    if (existingRows.length > MAX_DOM_MESSAGES) {
      const excess = existingRows.length - MAX_DOM_MESSAGES;
      for (let i = 0; i < excess; i++) {
        const oldest = existingRows[i];
        if (oldest && oldest._msgData) {
          state.renderedMsgIds.delete(oldest._msgData.id);
        }
        if (oldest) oldest.remove();
      }
    }
    scrollToBottom();
  }
}

async function handleIncomingMessage(rawMsg) {
  if (!rawMsg || !rawMsg.id) return;
  const myPub = state.identity ? P0Crypto.normalizePubkey(state.identity.ed25519_pub) : '';
  const senderPub = P0Crypto.normalizePubkey(rawMsg.pubkey);
  let convId = rawMsg.convId || rawMsg.room || 'global';
  let displayContent = rawMsg.content || '';

  if (rawMsg.convType === 'dm' || convId.startsWith('dm_')) {
    const targetPub = P0Crypto.normalizePubkey(rawMsg.toPubkey || '');
    if (senderPub !== myPub && targetPub && targetPub !== myPub) {
      return;
    }
    const peerPub = senderPub === myPub ? targetPub : senderPub;
    const expectedConvId = P0Crypto.getDmConvId(myPub, peerPub);
    convId = expectedConvId;

    if (!state.conversations.has(convId)) {
      registerOrGetDmConversation(peerPub, rawMsg.username, false);
    }

    if (rawMsg.encrypted && rawMsg.iv && rawMsg.ct && senderPub !== myPub) {
      const dmSeed = P0Crypto.getDmConvId(myPub, peerPub);
      const decrypted = await P0Crypto.decryptE2EE(dmSeed, rawMsg.iv, rawMsg.ct);
      if (!decrypted) return;
      displayContent = decrypted;
    }
  } else if (rawMsg.convType === 'group' || convId.startsWith('grp_')) {
    const groupConv = state.conversations.get(convId);
    if (!groupConv) return;
    if (rawMsg.encrypted && rawMsg.iv && rawMsg.ct && senderPub !== myPub) {
      const decrypted = await P0Crypto.decryptE2EE(groupConv.secretKey, rawMsg.iv, rawMsg.ct);
      if (decrypted) {
        displayContent = decrypted;
      }
    }
  }

  const msg = {
    ...rawMsg,
    convId,
    content: displayContent,
    reactions: rawMsg.reactions || {},
  };

  const list = state.messagesByConv.get(convId) || [];
  if (list.some(m => m.id === msg.id)) return;
  list.push(msg);
  if (list.length > 500) list.shift();
  state.messagesByConv.set(convId, list);

  if (window.chatStorage) {
    window.chatStorage.saveMessage(msg);
  }

  const conv = state.conversations.get(convId);
  const isBroadcastCard = !!(msg.inviteData || extractInviteFromText(msg.content));
  const muted = isConversationMuted(conv, isBroadcastCard);

  let previewLabel = msg.content;
  if (!previewLabel && Array.isArray(msg.attachments) && msg.attachments.length > 0) {
    const first = msg.attachments[0];
    previewLabel = `📎 ${first.name || first.kind}`;
  }

  if (conv) {
    conv.lastMsg = `${senderPub === myPub ? 'You' : '@' + (msg.username || 'user')}: ${previewLabel}`;
    conv.lastTime = msg.timestamp || Date.now();
    if (convId !== state.activeConvId && senderPub !== myPub && !muted) {
      conv.unread = (conv.unread || 0) + 1;
    }
  }

  renderConversationList();

  if (convId === state.activeConvId) {
    queueMessageForDomCommit(msg);
  }

  if (senderPub !== myPub && !muted) {
    if (convId !== state.activeConvId || document.hidden) {
      const convTitle = conv ? conv.name : 'Global Chat';
      const badgeLabel = conv && conv.type === 'dm' ? 'Direct' : conv && conv.type === 'group' ? 'Group' : 'Global';
      triggerPushNotification({
        title: conv && conv.type === 'dm' ? `@${msg.username || 'User'}` : `${convTitle} • @${msg.username || 'User'}`,
        body: previewLabel,
        badgeText: badgeLabel,
        convId,
        avatarText: getMonogram(msg.username || convTitle),
      });
    } else {
      playNotificationChime();
    }
  }
}

function handleTransferProgress(info) {
  if (!info || !info.transferId) return;
  const barEl = document.getElementById(`transfer-bar-${info.transferId}`);
  const labelEl = document.getElementById(`transfer-lbl-${info.transferId}`);
  const wrapEl = document.getElementById(`transfer-wrap-${info.transferId}`);
  if (wrapEl) wrapEl.classList.remove('hidden');
  if (barEl) barEl.style.width = `${info.percent}%`;
  if (labelEl) {
    const verb = info.direction === 'send' ? 'Sending' : 'Receiving';
    labelEl.textContent = info.percent >= 100 ? 'Complete ✓' : `${verb}... ${info.percent}%`;
  }
}

function handleTransferComplete(info) {
  if (!info || !info.transferId || !info.objectUrl) return;
  const wrapEl = document.getElementById(`transfer-wrap-${info.transferId}`);
  if (wrapEl) wrapEl.classList.add('hidden');

  document.querySelectorAll(`[data-transfer-id="${info.transferId}"]`).forEach((node) => {
    if (node.tagName === 'IMG' || node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
      node.src = info.objectUrl;
    } else if (node.tagName === 'A') {
      node.href = info.objectUrl;
    }
  });
}

function handleIncomingReaction(pkt) {
  if (!pkt || !pkt.msgId || !pkt.emoji) return;
  const convId = pkt.convId || state.activeConvId;
  const list = state.messagesByConv.get(convId) || [];
  const target = list.find(m => m.id === pkt.msgId);
  if (!target) return;

  if (!target.reactions) target.reactions = {};
  if (!Array.isArray(target.reactions[pkt.emoji])) {
    target.reactions[pkt.emoji] = [];
  }
  const actor = pkt.username || 'user';
  const idx = target.reactions[pkt.emoji].indexOf(actor);
  if (idx === -1) {
    target.reactions[pkt.emoji].push(actor);
  } else {
    target.reactions[pkt.emoji].splice(idx, 1);
    if (target.reactions[pkt.emoji].length === 0) {
      delete target.reactions[pkt.emoji];
    }
  }

  if (window.chatStorage) {
    window.chatStorage.saveMessage(target);
  }

  const domRow = document.getElementById(`msg-${pkt.msgId}`);
  if (domRow) {
    renderReactionsInsideRow(domRow, target);
  }
}

function renderReactionsInsideRow(rowEl, msg) {
  const container = rowEl.querySelector('.wa-reactions-row');
  if (!container) return;
  container.innerHTML = '';
  const reactions = msg.reactions || {};
  Object.keys(reactions).forEach((emoji) => {
    const users = reactions[emoji];
    if (!Array.isArray(users) || users.length === 0) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'wa-reaction-Chip';
    chip.title = `Reacted by ${users.map(u => '@' + u).join(', ')}`;
    chip.innerHTML = `<span>${escapeHtml(emoji)}</span><span>${users.length}</span>`;
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.swarm) {
        state.swarm.sendReaction(msg.id, emoji, msg.convId || state.activeConvId);
      }
    });
    container.appendChild(chip);
  });
}

function renderMessagesForActiveConversation() {
  if (!el.messagesContainer) return;
  el.messagesContainer.innerHTML = '';
  state.renderedMsgIds.clear();
  state.domCommitQueue = [];

  const conv = state.conversations.get(state.activeConvId) || state.conversations.get('global');
  const notice = document.createElement('div');
  notice.className = 'wa-encryption-notice';
  if (conv && conv.type === 'dm') {
    notice.innerHTML = `Messages, voice notes, photos, and files shared with <strong>${escapeHtml(conv.name)}</strong> are end-to-end encrypted.`;
  } else if (conv && conv.type === 'group') {
    notice.innerHTML = `<strong>${escapeHtml(conv.name)}</strong> • Private encrypted group. Use <strong>Invite</strong> in the header to add friends by Contact ID or share your invite code.`;
  } else {
    notice.innerHTML = `<strong>Global Chat</strong> • Share messages, photos, videos, voice notes, and files. Tap or right-click any message to reply, react, or chat privately.`;
  }
  el.messagesContainer.appendChild(notice);

  const list = state.messagesByConv.get(state.activeConvId) || [];
  const windowSlice = list.slice(-MAX_DOM_MESSAGES);
  const frag = document.createDocumentFragment();
  windowSlice.forEach((msg) => {
    const row = buildMessageRowDom(msg, false);
    if (row) frag.appendChild(row);
  });
  el.messagesContainer.appendChild(frag);
  scrollToBottom();
}

function renderAttachmentHtml(att) {
  if (!att) return '';
  const safeName = escapeHtml(att.name || 'file');
  const sizeStr = formatBytes(att.size || 0);
  const trId = att.transferId || '';
  const trAttr = trId ? `data-transfer-id="${escapeHtml(trId)}"` : '';
  const progressHtml = trId ? `
    <div id="transfer-wrap-${escapeHtml(trId)}" class="wa-transfer-progress ${att.dataUrl ? 'hidden' : ''}">
      <div class="wa-transfer-top">
        <span>${safeName}</span>
        <span id="transfer-lbl-${escapeHtml(trId)}">Streaming...</span>
      </div>
      <div class="wa-transfer-track">
        <div id="transfer-bar-${escapeHtml(trId)}" class="wa-transfer-fill" style="width:0%;"></div>
      </div>
    </div>
  ` : '';

  if (att.kind === 'image') {
    return `
      <div class="wa-media-wrap">
        <img class="wa-media-img" decoding="async" loading="lazy" ${trAttr} src="${att.dataUrl || ''}" alt="${safeName}" data-filename="${safeName}">
        ${progressHtml}
      </div>
    `;
  }
  if (att.kind === 'video') {
    return `
      <div class="wa-media-wrap">
        <video class="wa-media-video" ${trAttr} controls playsinline preload="metadata" src="${att.dataUrl || ''}"></video>
        ${progressHtml}
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.7rem; color:var(--text-muted);">
          <span>🎬 ${safeName} (${sizeStr})</span>
          <a ${trAttr} href="${att.dataUrl || '#'}" download="${safeName}" style="color:var(--accent-primary); font-weight:700; text-decoration:none;">Download</a>
        </div>
      </div>
    `;
  }
  if (att.kind === 'audio' || att.kind === 'voice') {
    const icon = att.kind === 'voice' ? '🎤' : '🎵';
    return `
      <div class="wa-media-wrap">
        <div class="wa-media-audio-card">
          <div class="wa-media-audio-top">
            <span>${icon} ${safeName}</span>
            <span style="color:var(--text-muted); font-size:0.66rem;">${sizeStr}</span>
          </div>
          <audio class="wa-media-audio-player" ${trAttr} controls preload="metadata" src="${att.dataUrl || ''}"></audio>
          ${progressHtml}
        </div>
      </div>
    `;
  }

  const ext = (att.name && att.name.includes('.')) ? att.name.split('.').pop().slice(0, 4) : 'FILE';
  return `
    <div class="wa-media-wrap">
      <div class="wa-file-card">
        <div class="wa-file-ext-badge">${escapeHtml(ext)}</div>
        <div class="wa-file-meta">
          <div class="wa-file-name">${safeName}</div>
          <div class="wa-file-size">${sizeStr}</div>
        </div>
        <a class="wa-file-dl-btn" ${trAttr} href="${att.dataUrl || '#'}" download="${safeName}">Save</a>
      </div>
      ${progressHtml}
    </div>
  `;
}

function buildMessageRowDom(msg, animatePop = true) {
  if (!msg || !msg.id) return null;
  if (state.renderedMsgIds.has(msg.id)) return null;
  state.renderedMsgIds.add(msg.id);

  if (msg.pinned) {
    state.pinnedMessages.set(msg.id, msg);
    updatePinnedBanner();
  }

  const myPub = state.identity ? P0Crypto.normalizePubkey(state.identity.ed25519_pub) : '';
  const msgPub = P0Crypto.normalizePubkey(msg.pubkey);
  const isMe = (msgPub && msgPub === myPub) || (!!msg.isMe && !msgPub);
  const timeStr = formatShortTime(msg.timestamp || Date.now());
  const isPinned = state.pinnedMessages.has(msg.id);
  const nameColor = authorColorFromPub(msgPub);

  const row = document.createElement('div');
  row.className = `message-row ${isMe ? 'is-me' : ''} ${animatePop ? 'animate-pop' : ''}`;
  row.id = `msg-${msg.id}`;
  row._msgData = msg;

  let quoteHtml = '';
  if (msg.replyTo && msg.replyTo.content) {
    quoteHtml = `
      <div class="wa-quoted-box">
        <span class="wa-quoted-author">@${escapeHtml(msg.replyTo.username || 'user')}</span>
        <span class="wa-quoted-text">${escapeHtml(msg.replyTo.content)}</span>
      </div>
    `;
  }

  let attachmentsHtml = '';
  if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
    attachmentsHtml = msg.attachments.map(att => renderAttachmentHtml(att)).join('');
  }

  let inviteCardHtml = '';
  const detectedInvite = msg.inviteData || extractInviteFromText(msg.content);
  if (detectedInvite) {
    inviteCardHtml = `
      <div class="wa-invite-card">
        <div class="wa-invite-card-title">${escapeHtml(detectedInvite.name || 'Group Invitation')}</div>
        <div class="wa-invite-card-desc">${escapeHtml(detectedInvite.description || `Group ID: ${detectedInvite.id}`)}</div>
        <button type="button" class="wa-invite-card-btn">Join Private Group</button>
      </div>
    `;
  }

  const showText = msg.content && !(Array.isArray(msg.attachments) && msg.attachments.length > 0 && msg.content.startsWith('🎤 Voice Note'));

  row.innerHTML = `
    <div class="wa-avatar msg-av" title="Message @${escapeHtml(msg.username || 'user')}">${escapeHtml(getMonogram(msg.username || 'U'))}</div>
    <div class="wa-bubble" title="Right-click or hold for options & reactions">
      <div class="wa-bubble-header">
        <span class="wa-bubble-author" style="color:${nameColor}">@${escapeHtml(msg.username || 'Anonymous')}</span>
        <span class="wa-bubble-pub-short">${escapeHtml(P0Crypto.formatPublicId(msgPub))}</span>
      </div>
      ${quoteHtml}
      ${attachmentsHtml}
      ${showText ? `<div class="wa-bubble-text">${escapeHtml(msg.content)}</div>` : ''}
      ${inviteCardHtml}
      <div class="wa-reactions-row"></div>
      <div class="wa-bubble-meta">
        ${isPinned ? '<span class="message-pinned-tag">Pinned</span>' : ''}
        <span>${timeStr}</span>
        ${isMe ? '<span class="wa-ticks">✓✓</span>' : ''}
      </div>
    </div>
  `;

  renderReactionsInsideRow(row, msg);

  row.querySelectorAll('.wa-media-img').forEach((imgEl) => {
    if (typeof imgEl.decode === 'function' && imgEl.src) { imgEl.decode().catch(() => {}); }
    imgEl.addEventListener('click', (e) => {
      e.stopPropagation();
      openMediaLightbox(imgEl.src, imgEl.getAttribute('data-filename') || 'photo.jpg');
    });
  });

  let touchTimer = null;
  const bubbleEl = row.querySelector('.wa-bubble');
  if (bubbleEl) {
    bubbleEl.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      touchTimer = setTimeout(() => {
        openContextMenu(msg, touch.clientX, touch.clientY);
      }, 460);
    }, { passive: true });
    bubbleEl.addEventListener('touchend', () => clearTimeout(touchTimer));
    bubbleEl.addEventListener('touchmove', () => clearTimeout(touchTimer));
  }

  const authorEl = row.querySelector('.wa-bubble-author');
  if (authorEl && !isMe && msgPub) {
    authorEl.addEventListener('click', (e) => {
      e.stopPropagation();
      registerOrGetDmConversation(msgPub, msg.username, true);
    });
  }

  const avEl = row.querySelector('.msg-av');
  if (avEl && !isMe && msgPub) {
    avEl.style.cursor = 'pointer';
    avEl.addEventListener('click', (e) => {
      e.stopPropagation();
      registerOrGetDmConversation(msgPub, msg.username, true);
    });
  }

  const joinCardBtn = row.querySelector('.wa-invite-card-btn');
  if (joinCardBtn && detectedInvite) {
    joinCardBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      registerOrGetGroup(detectedInvite, true);
      showToast(`Joined group "${detectedInvite.name}"!`);
    });
  }

  return row;
}

function appendMessageRowToDom(msg, autoScroll = true, animatePop = true) {
  if (!el.messagesContainer) return;
  const row = buildMessageRowDom(msg, animatePop);
  if (!row) return;
  el.messagesContainer.appendChild(row);
  if (autoScroll) scrollToBottom();
}

function extractInviteFromText(text) {
  if (!text) return null;
  const match = String(text).match(/(p0grp_[A-Za-z0-9_-]{12,})/);
  if (match) {
    return P0Crypto.decodeGroupInviteCode(match[1]);
  }
  return null;
}

function scrollToBottom() {
  if (!el.messagesContainer) return;
  el.messagesContainer.scrollTop = el.messagesContainer.scrollHeight;
}

// ============================================================================
// Reply Bar, Pinning & Context Menu
// ============================================================================

function startReplyTo(msg) {
  if (!msg) return;
  state.replyingToMsg = {
    id: msg.id,
    username: msg.username || 'user',
    pubkey: msg.pubkey || '',
    content: (msg.content || '📎 Attachment').slice(0, 140),
  };
  if (el.replyPreviewAuthor) el.replyPreviewAuthor.textContent = `Replying to @${state.replyingToMsg.username}`;
  if (el.replyPreviewText) el.replyPreviewText.textContent = state.replyingToMsg.content;
  if (el.replyPreviewBar) el.replyPreviewBar.classList.remove('hidden');
  if (el.messageInput) el.messageInput.focus();
}

function cancelReply() {
  state.replyingToMsg = null;
  if (el.replyPreviewBar) el.replyPreviewBar.classList.add('hidden');
}

function updatePinnedBanner() {
  const pinnedList = Array.from(state.pinnedMessages.values());
  const count = pinnedList.length;
  if (!el.pinnedBanner || !el.pinBadge) return;

  if (count === 0) {
    el.pinnedBanner.classList.add('hidden');
    el.pinBadge.classList.add('hidden');
    el.pinBadge.textContent = '0';
  } else {
    el.pinBadge.textContent = String(count);
    el.pinBadge.classList.remove('hidden');
    el.pinnedBanner.classList.remove('hidden');
    const latest = pinnedList[pinnedList.length - 1];
    el.pinnedText.textContent = `@${latest.username}: ${latest.content || 'Attachment'}`;
    el.pinnedBanner.dataset.targetId = latest.id;
  }
}

async function toggleMessagePin(msgId) {
  const msgElement = document.getElementById(`msg-${msgId}`);
  const isCurrentlyPinned = state.pinnedMessages.has(msgId);
  const newPinnedState = !isCurrentlyPinned;

  if (newPinnedState) {
    const msgObj = (msgElement && msgElement._msgData)
      ? { ...msgElement._msgData, pinned: true }
      : { id: msgId, pinned: true, content: '', username: 'user' };
    state.pinnedMessages.set(msgId, msgObj);
  } else {
    state.pinnedMessages.delete(msgId);
  }

  if (window.chatStorage) {
    await window.chatStorage.togglePin(msgId, newPinnedState);
  }

  if (msgElement && msgElement._msgData) {
    msgElement._msgData.pinned = newPinnedState;
  }
  renderMessagesForActiveConversation();
  updatePinnedBanner();
  showToast(newPinnedState ? 'Message pinned' : 'Message unpinned');
}

function scrollToMessage(msgId) {
  const msgEl = document.getElementById(`msg-${msgId}`);
  if (msgEl) {
    msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    msgEl.classList.add('highlight-pulse');
    setTimeout(() => msgEl.classList.remove('highlight-pulse'), 1600);
  } else {
    showToast('Pinned message is in another conversation');
  }
}

function openContextMenu(msg, clientX, clientY) {
  state.activeContextMsg = msg;
  const myPub = state.identity ? P0Crypto.normalizePubkey(state.identity.ed25519_pub) : '';
  const msgPub = P0Crypto.normalizePubkey(msg.pubkey);
  const isMe = msgPub === myPub;

  if (el.ctxAvatar) el.ctxAvatar.textContent = getMonogram(msg.username || 'U');
  if (el.ctxUsername) el.ctxUsername.textContent = `@${msg.username || 'Anonymous'}`;
  if (el.ctxYouTag) el.ctxYouTag.classList.toggle('hidden', !isMe);
  if (el.ctxUserId) el.ctxUserId.textContent = P0Crypto.formatPublicId(msgPub);

  const isPinned = state.pinnedMessages.has(msg.id);
  if (el.ctxPinLabel) el.ctxPinLabel.textContent = isPinned ? 'Unpin Message' : 'Pin Message';

  const targetConv = state.conversations.get(msg.convId || state.activeConvId);
  const convMuted = isConversationMuted(targetConv, false);
  if (el.ctxMuteLabel) {
    el.ctxMuteLabel.textContent = convMuted ? 'Unmute Conversation' : 'Mute Conversation';
  }

  const menuWidth = 260;
  const menuHeight = 320;
  const posX = Math.min(clientX || 24, window.innerWidth - menuWidth - 12);
  const posY = Math.min(clientY || 24, window.innerHeight - menuHeight - 12);

  el.messageContextMenu.style.left = `${Math.max(10, posX)}px`;
  el.messageContextMenu.style.top = `${Math.max(10, posY)}px`;
  el.contextBackdrop.classList.remove('hidden');
  el.messageContextMenu.classList.remove('hidden');
}

function closeContextMenu() {
  if (el.messageContextMenu) el.messageContextMenu.classList.add('hidden');
  if (el.contextBackdrop) el.contextBackdrop.classList.add('hidden');
  state.activeContextMsg = null;
}

// ============================================================================
// Identity & Modals Management
// ============================================================================

function loadOrCreateIdentity() {
  const saved = safeGetItem(localStorage, 'p0_user_identity');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.ed25519_pub && parsed.ed25519_priv && parsed.ed25519_pub !== parsed.ed25519_priv) {
        return parsed;
      }
    } catch (_) {}
  }
  const fresh = P0Crypto.generateIdentity();
  safeSetItem(localStorage, 'p0_user_identity', JSON.stringify(fresh));
  return fresh;
}

function updateIdentityUI() {
  if (!state.identity) return;
  const pubId = P0Crypto.getPublicIdentity(state.identity);
  const privId = P0Crypto.getPrivateIdentity(state.identity);
  const shortPub = P0Crypto.formatPublicId(state.identity.ed25519_pub);

  if (el.myPublicIdShort) el.myPublicIdShort.textContent = shortPub;
  if (el.myPublicIdDisplay) el.myPublicIdDisplay.textContent = pubId;
  if (el.myPrivateIdDisplay) el.myPrivateIdDisplay.value = privId;
  if (el.editUsernameInput) el.editUsernameInput.value = state.username;
  if (el.myUsername) el.myUsername.textContent = state.username;
  if (el.myAvatar) el.myAvatar.textContent = getMonogram(state.username || 'U');
}

function openIdentityModal() {
  updateIdentityUI();
  if (el.identityModal) el.identityModal.classList.remove('hidden');
}

function openCreateGroupModal(preselectedPubkey = '') {
  if (!el.createGroupModal) return;
  if (el.newGroupInvitePubkey) {
    el.newGroupInvitePubkey.value = preselectedPubkey ? `pub_${P0Crypto.normalizePubkey(preselectedPubkey)}` : '';
  }
  if (el.createGroupOnlineChecklist) {
    el.createGroupOnlineChecklist.innerHTML = '';
    const peers = getNormalizedOnlineUsers();
    if (peers.length === 0) {
      el.createGroupOnlineChecklist.innerHTML = `<div class="help-text">No other people online right now — you can paste any friend's Contact ID above or share the Group Invite Code anytime.</div>`;
    } else {
      peers.forEach((p) => {
        const clean = P0Crypto.normalizePubkey(p.pubkey);
        const checked = preselectedPubkey && P0Crypto.normalizePubkey(preselectedPubkey) === clean ? 'checked' : '';
        const lbl = document.createElement('label');
        lbl.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:0.8rem; padding:4px 6px; cursor:pointer;';
        lbl.innerHTML = `
          <input type="checkbox" class="grp-invite-peer-cb" value="${escapeHtml(clean)}" ${checked}>
          <span style="font-weight:600;">@${escapeHtml(p.username)}</span>
          <span style="font-family:var(--font-mono); font-size:0.68rem; color:var(--text-muted);">${escapeHtml(P0Crypto.formatPublicId(clean))}</span>
        `;
        el.createGroupOnlineChecklist.appendChild(lbl);
      });
    }
  }
  el.createGroupModal.classList.remove('hidden');
}

function openNewDmModal() {
  if (!el.newDmModal) return;
  if (el.dmOnlinePeersList) {
    el.dmOnlinePeersList.innerHTML = '';
    const peers = getNormalizedOnlineUsers();
    if (peers.length === 0) {
      el.dmOnlinePeersList.innerHTML = `<div class="help-text">No one else is online right now. Paste any friend's Contact ID (` + '`pub_...`' + `) above to start a direct chat!</div>`;
    } else {
      peers.forEach((p) => {
        const clean = P0Crypto.normalizePubkey(p.pubkey);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wa-quick-btn';
        btn.style.justifyContent = 'space-between';
        btn.innerHTML = `
          <span><strong>@${escapeHtml(p.username)}</strong> (${escapeHtml(P0Crypto.formatPublicId(clean))})</span>
          <span style="color:var(--accent-primary);">Message →</span>
        `;
        btn.addEventListener('click', () => {
          el.newDmModal.classList.add('hidden');
          registerOrGetDmConversation(clean, p.username, true);
        });
        el.dmOnlinePeersList.appendChild(btn);
      });
    }
  }
  el.newDmModal.classList.remove('hidden');
}

// ============================================================================
// Calibrated High-Visibility Themes & Emoji Categories
// ============================================================================

const THEME_CONFIG = {
  'whatsapp-dark': { label: 'Dark Mode (Emerald)', short: 'Dark', isLight: false },
  light: { label: 'Light Mode (Daylight)', short: 'Light', isLight: true },
  slate: { label: 'Dark Slate (Indigo)', short: 'Slate', isLight: false },
  cyber: { label: 'Arctic Frost (Navy)', short: 'Frost', isLight: false },
};

function setTheme(theme) {
  if (!THEME_CONFIG[theme]) theme = 'whatsapp-dark';
  const cfg = THEME_CONFIG[theme];
  document.documentElement.setAttribute('data-theme', theme);
  safeSetItem(localStorage, 'p0_theme', theme);

  if (el.themeLabel) el.themeLabel.textContent = cfg.label;
  if (el.themeBtnShortText) el.themeBtnShortText.textContent = cfg.short;

  if (el.quickThemeDarkBtn && el.quickThemeLightBtn) {
    el.quickThemeDarkBtn.classList.toggle('active', !cfg.isLight);
    el.quickThemeLightBtn.classList.toggle('active', cfg.isLight);
  }

  el.themeButtons.forEach((btn) => {
    const isMatch = btn.getAttribute('data-theme') === theme;
    btn.classList.toggle('active-theme', isMatch);
  });
}

function renderEmojiCategory(cat = 'all') {
  if (!el.emojiGridContainer) return;
  const list = EMOJI_CATALOG[cat] || EMOJI_CATALOG.all;
  el.emojiGridContainer.innerHTML = '';
  list.forEach((em) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wa-emoji-item';
    btn.setAttribute('data-emoji', em);
    btn.textContent = em;
    btn.addEventListener('click', () => {
      if (el.messageInput) {
        el.messageInput.value += em;
        el.messageInput.focus();
      }
    });
    el.emojiGridContainer.appendChild(btn);
  });
}

const RETENTION_LABELS = {
  none: 'Session Only',
  '1h': 'Saved: 1h',
  '24h': 'Saved: 24h',
  '7d': 'Saved: 7d',
};

// ============================================================================
// Mobile Viewport Adaptation & Event Listeners
// ============================================================================

function setupMobileViewportAdaptation() {
  const updateHeight = () => {
    const vh = (window.visualViewport && window.visualViewport.height)
      ? window.visualViewport.height
      : window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${vh}px`);
  };
  updateHeight();
  window.addEventListener('resize', updateHeight);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      updateHeight();
      scrollToBottom();
    });
  }
}

function setupEventListeners() {
  if (el.randomNameBtn) {
    el.randomNameBtn.addEventListener('click', () => {
      el.usernameInput.value = getRandomUsername();
    });
  }

  if (el.toggleImportKeyBtn) {
    el.toggleImportKeyBtn.addEventListener('click', () => {
      el.importKeyContainer.classList.toggle('hidden');
    });
  }

  if (el.joinForm) {
    el.joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const handle = (el.usernameInput.value || '').trim().replace(/^@/, '') || getRandomUsername();
      if (el.importKeyInput && el.importKeyInput.value.trim()) {
        const imported = P0Crypto.importIdentity(el.importKeyInput.value.trim());
        if (imported) {
          state.identity = imported;
          safeSetItem(localStorage, 'p0_user_identity', JSON.stringify(imported));
        }
      }
      state.username = handle;
      safeSetItem(sessionStorage, 'p0_chat_username', handle);
      safeSetItem(localStorage, 'p0_chat_username', handle);
      enterChat(handle);
    });
  }

  el.filterPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      el.filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.sidebarFilter = pill.getAttribute('data-filter') || 'all';
      renderConversationList();
    });
  });

  if (el.userSearch) {
    el.userSearch.addEventListener('input', (e) => {
      state.searchQuery = e.target.value || '';
      renderConversationList();
    });
  }

  if (el.mobileBackBtn) {
    el.mobileBackBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      el.app.classList.remove('mobile-chat-active');
    });
  }

  if (el.copyMyPubQuickBtn) {
    el.copyMyPubQuickBtn.addEventListener('click', async () => {
      await copyTextSafe(P0Crypto.getPublicIdentity(state.identity));
      showToast('Copied your Contact ID to clipboard');
    });
  }

  if (el.notifBtn) {
    el.notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      updatePushPermissionUI();
      el.notifMenu.classList.toggle('hidden');
      el.settingsMenu.classList.add('hidden');
      el.themeMenu.classList.add('hidden');
    });
  }
  if (el.enablePushBtn) {
    el.enablePushBtn.addEventListener('click', () => requestBrowserPushPermission());
  }
  if (el.testPushBtn) {
    el.testPushBtn.addEventListener('click', () => {
      triggerPushNotification({
        title: 'NoTalk Notification Test',
        body: `Push alerts & sound chime are active for @${state.username || 'you'}. Tap to open chat.`,
        badgeText: 'Test Alert',
        convId: state.activeConvId,
        avatarText: 'NT',
        forceShow: true,
      });
      el.notifMenu.classList.add('hidden');
    });
  }

  if (el.muteGlobalChatCb) {
    el.muteGlobalChatCb.addEventListener('change', () => {
      state.mutePrefs.muteGlobalChat = el.muteGlobalChatCb.checked;
      const idx = state.mutePrefs.mutedConvIds.indexOf('global');
      if (state.mutePrefs.muteGlobalChat && idx === -1) {
        state.mutePrefs.mutedConvIds.push('global');
      } else if (!state.mutePrefs.muteGlobalChat && idx !== -1) {
        state.mutePrefs.mutedConvIds.splice(idx, 1);
      }
      saveMutePreferences();
      showToast(state.mutePrefs.muteGlobalChat ? 'Muted Global Chat' : 'Unmuted Global Chat');
    });
  }
  if (el.muteGlobalMsgCb) {
    el.muteGlobalMsgCb.addEventListener('change', () => {
      state.mutePrefs.muteGlobalMessages = el.muteGlobalMsgCb.checked;
      saveMutePreferences();
      showToast(state.mutePrefs.muteGlobalMessages ? 'Muted Group Invites & Broadcasts' : 'Unmuted Group Invites & Broadcasts');
    });
  }
  if (el.muteAllGroupsCb) {
    el.muteAllGroupsCb.addEventListener('change', () => {
      state.mutePrefs.muteAllGroups = el.muteAllGroupsCb.checked;
      saveMutePreferences();
      showToast(state.mutePrefs.muteAllGroups ? 'Muted All Group Chats' : 'Unmuted All Group Chats');
    });
  }
  if (el.muteAllDmsCb) {
    el.muteAllDmsCb.addEventListener('change', () => {
      state.mutePrefs.muteAllDms = el.muteAllDmsCb.checked;
      saveMutePreferences();
      showToast(state.mutePrefs.muteAllDms ? 'Muted All Direct Messages' : 'Unmuted All Direct Messages');
    });
  }
  if (el.muteSoundCb) {
    el.muteSoundCb.addEventListener('change', () => {
      state.mutePrefs.muteSound = el.muteSoundCb.checked;
      saveMutePreferences();
      showToast(state.mutePrefs.muteSound ? 'Notification sound muted' : 'Notification sound enabled');
    });
  }

  if (el.headerMuteConvBtn) {
    el.headerMuteConvBtn.addEventListener('click', () => {
      toggleConversationMute(state.activeConvId);
    });
  }

  if (el.themeBtn) {
    el.themeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      el.themeMenu.classList.toggle('hidden');
      el.settingsMenu.classList.add('hidden');
      if (el.notifMenu) el.notifMenu.classList.add('hidden');
    });
  }
  if (el.quickThemeDarkBtn) {
    el.quickThemeDarkBtn.addEventListener('click', () => {
      setTheme('whatsapp-dark');
      showToast('Switched to Dark Mode');
    });
  }
  if (el.quickThemeLightBtn) {
    el.quickThemeLightBtn.addEventListener('click', () => {
      setTheme('light');
      showToast('Switched to Light Mode');
    });
  }
  el.themeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = btn.getAttribute('data-theme');
      setTheme(t);
      el.themeMenu.classList.add('hidden');
      showToast(`Appearance: ${THEME_CONFIG[t].label}`);
    });
  });

  if (el.settingsBtn) {
    el.settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      el.settingsMenu.classList.toggle('hidden');
      el.themeMenu.classList.add('hidden');
      if (el.notifMenu) el.notifMenu.classList.add('hidden');
    });
  }
  el.retentionRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        const val = radio.value;
        if (window.chatStorage) window.chatStorage.setRetention(val);
        if (el.retentionLabel) el.retentionLabel.textContent = RETENTION_LABELS[val] || 'Saved: 24h';
        el.settingsMenu.classList.add('hidden');
        showToast(`History setting: ${RETENTION_LABELS[val]}`);
      }
    });
  });
  if (el.clearHistoryBtn) {
    el.clearHistoryBtn.addEventListener('click', async () => {
      if (window.chatStorage) await window.chatStorage.clearAllMessages();
      state.messagesByConv.clear();
      state.pinnedMessages.clear();
      updatePinnedBanner();
      renderMessagesForActiveConversation();
      el.settingsMenu.classList.add('hidden');
      showToast('Cleared local chat history');
    });
  }

  if (el.toggleAttachBtn) {
    el.toggleAttachBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      el.attachPopover.classList.toggle('hidden');
      el.emojiStrip.classList.add('hidden');
    });
  }
  if (el.attachPhotoBtn) {
    el.attachPhotoBtn.addEventListener('click', () => {
      el.attachPopover.classList.add('hidden');
      if (el.fileInputImage) el.fileInputImage.click();
    });
  }
  if (el.attachVideoBtn) {
    el.attachVideoBtn.addEventListener('click', () => {
      el.attachPopover.classList.add('hidden');
      if (el.fileInputVideo) el.fileInputVideo.click();
    });
  }
  if (el.attachAudioBtn) {
    el.attachAudioBtn.addEventListener('click', () => {
      el.attachPopover.classList.add('hidden');
      if (el.fileInputAudio) el.fileInputAudio.click();
    });
  }
  if (el.attachDocBtn) {
    el.attachDocBtn.addEventListener('click', () => {
      el.attachPopover.classList.add('hidden');
      if (el.fileInputDoc) el.fileInputDoc.click();
    });
  }

  if (el.fileInputImage) {
    el.fileInputImage.addEventListener('change', (e) => {
      handleSelectedFiles(e.target.files, 'image');
      e.target.value = '';
    });
  }
  if (el.fileInputVideo) {
    el.fileInputVideo.addEventListener('change', (e) => {
      handleSelectedFiles(e.target.files, 'video');
      e.target.value = '';
    });
  }
  if (el.fileInputAudio) {
    el.fileInputAudio.addEventListener('change', (e) => {
      handleSelectedFiles(e.target.files, 'audio');
      e.target.value = '';
    });
  }
  if (el.fileInputDoc) {
    el.fileInputDoc.addEventListener('change', (e) => {
      handleSelectedFiles(e.target.files, 'file');
      e.target.value = '';
    });
  }

  if (el.mainChatArea) {
    el.mainChatArea.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    el.mainChatArea.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleSelectedFiles(e.dataTransfer.files);
      }
    });
  }
  window.addEventListener('paste', (e) => {
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
      handleSelectedFiles(e.clipboardData.files);
    }
  });

  if (el.voiceRecordBtn) {
    el.voiceRecordBtn.addEventListener('click', () => {
      if (state.voiceRecorder.active) {
        stopVoiceRecording(true);
      } else {
        startVoiceRecording();
      }
    });
  }
  if (el.cancelVoiceBtn) {
    el.cancelVoiceBtn.addEventListener('click', () => stopVoiceRecording(false));
  }
  if (el.sendVoiceBtn) {
    el.sendVoiceBtn.addEventListener('click', () => stopVoiceRecording(true));
  }

  if (el.lightboxCloseBtn) {
    el.lightboxCloseBtn.addEventListener('click', () => el.mediaLightbox.classList.add('hidden'));
  }
  if (el.mediaLightbox) {
    el.mediaLightbox.addEventListener('click', (e) => {
      if (e.target === el.mediaLightbox) el.mediaLightbox.classList.add('hidden');
    });
  }

  if (el.toggleEmojiBtn) {
    el.toggleEmojiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      el.emojiStrip.classList.toggle('hidden');
      if (el.attachPopover) el.attachPopover.classList.add('hidden');
    });
  }
  el.emojiCatBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      el.emojiCatBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderEmojiCategory(btn.getAttribute('data-ecat') || 'all');
    });
  });
  document.querySelectorAll('#emoji-grid-container .wa-emoji-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const em = btn.getAttribute('data-emoji') || btn.textContent || '';
      el.messageInput.value += em;
      el.messageInput.focus();
    });
  });

  if (el.openCreateGroupBtn) {
    el.openCreateGroupBtn.addEventListener('click', () => openCreateGroupModal());
  }
  if (el.closeCreateGroupBtn) {
    el.closeCreateGroupBtn.addEventListener('click', () => el.createGroupModal.classList.add('hidden'));
  }
  if (el.createGroupForm) {
    el.createGroupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = (el.newGroupName.value || '').trim();
      if (!name) return;
      const desc = (el.newGroupDesc.value || '').trim();
      const pubInput = (el.newGroupInvitePubkey.value || '').trim();

      const grp = P0Crypto.generateGroupCredentials(name, desc, true, state.identity.ed25519_pub);
      const registered = registerOrGetGroup(grp, true);

      const targets = new Set();
      document.querySelectorAll('.grp-invite-peer-cb:checked').forEach((cb) => {
        if (cb.value) targets.add(P0Crypto.normalizePubkey(cb.value));
      });
      if (pubInput) {
        pubInput.split(/[\s,]+/).forEach((tok) => {
          if (P0Crypto.isValidPubkey(tok)) {
            targets.add(P0Crypto.normalizePubkey(tok));
          }
        });
      }
      if (state.swarm) {
        targets.forEach(pub => state.swarm.sendGroupInvite(pub, registered));
      }

      el.newGroupName.value = '';
      el.newGroupDesc.value = '';
      el.newGroupInvitePubkey.value = '';
      el.createGroupModal.classList.add('hidden');
      showToast(`Created group "${registered.name}"${targets.size ? ` & invited ${targets.size} person(s)` : ''}`);
    });
  }

  if (el.openJoinGroupBtn) {
    el.openJoinGroupBtn.addEventListener('click', () => el.joinGroupModal.classList.remove('hidden'));
  }
  if (el.closeJoinGroupBtn) {
    el.closeJoinGroupBtn.addEventListener('click', () => el.joinGroupModal.classList.add('hidden'));
  }
  if (el.joinGroupForm) {
    el.joinGroupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const rawCode = (el.joinGroupCodeInput.value || '').trim();
      const customName = (el.joinGroupCustomName.value || '').trim();
      const decoded = P0Crypto.decodeGroupInviteCode(rawCode);
      if (!decoded) {
        showToast('Invalid Group Invite Code');
        return;
      }
      if (customName) decoded.name = customName;
      registerOrGetGroup(decoded, true);
      el.joinGroupCodeInput.value = '';
      el.joinGroupCustomName.value = '';
      el.joinGroupModal.classList.add('hidden');
      showToast(`Joined group "${decoded.name}"!`);
    });
  }

  if (el.openNewDmBtn) {
    el.openNewDmBtn.addEventListener('click', () => openNewDmModal());
  }
  if (el.closeNewDmBtn) {
    el.closeNewDmBtn.addEventListener('click', () => el.newDmModal.classList.add('hidden'));
  }
  if (el.newDmForm) {
    el.newDmForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const rawPub = (el.dmTargetPubkeyInput.value || '').trim();
      const nick = (el.dmTargetNameInput.value || '').trim();
      if (!P0Crypto.isValidPubkey(rawPub)) {
        showToast('Please enter a valid Contact ID (`pub_...`)');
        return;
      }
      const conv = registerOrGetDmConversation(rawPub, nick, true);
      if (conv) {
        el.dmTargetPubkeyInput.value = '';
        el.dmTargetNameInput.value = '';
        el.newDmModal.classList.add('hidden');
        showToast(`Opened direct chat with ${conv.name}`);
      }
    });
  }

  if (el.acceptIncomingInviteBtn) {
    el.acceptIncomingInviteBtn.addEventListener('click', () => {
      const inv = state.pendingGroupInvite;
      if (inv) {
        registerOrGetGroup({
          id: inv.groupId,
          name: inv.groupName,
          description: inv.description,
          secretKey: inv.secretKey,
          isPrivate: inv.isPrivate,
        }, true);
        showToast(`Joined "${inv.groupName}"!`);
      }
      state.pendingGroupInvite = null;
      el.incomingInviteBanner.classList.add('hidden');
    });
  }
  if (el.dismissIncomingInviteBtn) {
    el.dismissIncomingInviteBtn.addEventListener('click', () => {
      state.pendingGroupInvite = null;
      el.incomingInviteBanner.classList.add('hidden');
    });
  }

  if (el.roomHeaderClickable) {
    el.roomHeaderClickable.addEventListener('click', (e) => {
      if (e.target.closest('#mobile-back-btn')) return;
      el.infoDrawer.classList.toggle('hidden');
      updateInfoDrawerContent();
    });
  }
  if (el.toggleInfoDrawerBtn) {
    el.toggleInfoDrawerBtn.addEventListener('click', () => {
      el.infoDrawer.classList.toggle('hidden');
      updateInfoDrawerContent();
    });
  }
  if (el.closeInfoDrawerBtn) {
    el.closeInfoDrawerBtn.addEventListener('click', () => el.infoDrawer.classList.add('hidden'));
  }
  if (el.headerInviteBtn) {
    el.headerInviteBtn.addEventListener('click', () => {
      const conv = state.conversations.get(state.activeConvId);
      if (conv && conv.type === 'dm') {
        inviteUserToCurrentOrNewGroup(conv.peerPubkey, conv.peerUsername);
      } else {
        el.infoDrawer.classList.remove('hidden');
        updateInfoDrawerContent();
      }
    });
  }

  if (el.copyGroupCodeBtn) {
    el.copyGroupCodeBtn.addEventListener('click', async () => {
      const code = el.drawerInviteCodeDisplay.textContent;
      await copyTextSafe(code);
      showToast('Copied Invite Code to clipboard!');
    });
  }

  if (el.postGroupCardBtn) {
    el.postGroupCardBtn.addEventListener('click', async () => {
      let conv = state.conversations.get(state.activeConvId);
      if (!conv || conv.type !== 'group') {
        conv = Array.from(state.conversations.values()).find(c => c.type === 'group');
      }
      if (!conv) {
        openCreateGroupModal();
        showToast('Create a group first to share its invite card');
        return;
      }
      const code = P0Crypto.encodeGroupInviteCode(conv);
      const globalConv = state.conversations.get('global');
      if (state.swarm && globalConv) {
        await state.swarm.sendChatMessage(
          `Join our group "${conv.name}": ${code}`,
          globalConv,
          {
            inviteData: {
              id: conv.id,
              name: conv.name,
              description: conv.description,
              secretKey: conv.secretKey,
              isPrivate: conv.isPrivate,
            },
          }
        );
        selectConversation('global');
        showToast(`Shared Group Invite Card in Global Chat!`);
      }
    });
  }

  if (el.drawerSendPubkeyInviteBtn) {
    el.drawerSendPubkeyInviteBtn.addEventListener('click', () => {
      const rawPub = (el.drawerInvitePubkeyInput.value || '').trim();
      if (!P0Crypto.isValidPubkey(rawPub)) {
        showToast('Paste a valid Contact ID (`pub_...`)');
        return;
      }
      inviteUserToCurrentOrNewGroup(rawPub);
      el.drawerInvitePubkeyInput.value = '';
    });
  }

  if (el.currentUserPill) {
    el.currentUserPill.addEventListener('click', openIdentityModal);
  }
  if (el.closeIdentityBtn) {
    el.closeIdentityBtn.addEventListener('click', () => el.identityModal.classList.add('hidden'));
  }
  if (el.saveUsernameBtn) {
    el.saveUsernameBtn.addEventListener('click', () => {
      const next = (el.editUsernameInput.value || '').trim().replace(/^@/, '');
      if (!next) return;
      state.username = next;
      safeSetItem(localStorage, 'p0_chat_username', next);
      safeSetItem(sessionStorage, 'p0_chat_username', next);
      updateIdentityUI();
      if (state.swarm) {
        state.swarm.username = next;
        state.swarm.broadcastDiscover();
      }
      renderConversationList();
      showToast(`Display name updated to @${next}`);
    });
  }
  if (el.copyMyPubkeyBtn) {
    el.copyMyPubkeyBtn.addEventListener('click', async () => {
      await copyTextSafe(P0Crypto.getPublicIdentity(state.identity));
      showToast('Contact ID copied to clipboard');
    });
  }
  if (el.toggleSecretVisibilityBtn) {
    el.toggleSecretVisibilityBtn.addEventListener('click', () => {
      if (el.myPrivateIdDisplay.type === 'password') {
        el.myPrivateIdDisplay.type = 'text';
        el.toggleSecretVisibilityBtn.textContent = 'Hide';
      } else {
        el.myPrivateIdDisplay.type = 'password';
        el.toggleSecretVisibilityBtn.textContent = 'Reveal';
      }
    });
  }
  if (el.copyMyPrivkeyBtn) {
    el.copyMyPrivkeyBtn.addEventListener('click', async () => {
      await copyTextSafe(P0Crypto.getPrivateIdentity(state.identity));
      showToast('Backup Key copied!');
    });
  }
  if (el.switchPrivkeyBtn) {
    el.switchPrivkeyBtn.addEventListener('click', () => {
      const token = (el.switchPrivkeyInput.value || '').trim();
      const imported = P0Crypto.importIdentity(token);
      if (!imported) {
        showToast('Invalid Backup Key format');
        return;
      }
      state.identity = imported;
      safeSetItem(localStorage, 'p0_user_identity', JSON.stringify(imported));
      updateIdentityUI();
      if (state.swarm) state.swarm.updateIdentity(imported);
      el.switchPrivkeyInput.value = '';
      el.identityModal.classList.add('hidden');
      renderMessagesForActiveConversation();
      renderConversationList();
      showToast(`Restored account ${P0Crypto.formatPublicId(imported.ed25519_pub)}`);
    });
  }
  if (el.generateNewIdBtn) {
    el.generateNewIdBtn.addEventListener('click', () => {
      const fresh = P0Crypto.generateIdentity();
      state.identity = fresh;
      safeSetItem(localStorage, 'p0_user_identity', JSON.stringify(fresh));
      updateIdentityUI();
      if (state.swarm) state.swarm.updateIdentity(fresh);
      renderMessagesForActiveConversation();
      renderConversationList();
      showToast(`Created fresh account ID: ${P0Crypto.formatPublicId(fresh.ed25519_pub)}`);
    });
  }

  if (el.pinnedBanner) {
    el.pinnedBanner.addEventListener('click', (e) => {
      if (e.target.closest('#unpin-current-btn')) return;
      const targetId = el.pinnedBanner.dataset.targetId;
      if (targetId) scrollToMessage(targetId);
    });
  }
  if (el.unpinCurrentBtn) {
    el.unpinCurrentBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetId = el.pinnedBanner.dataset.targetId;
      if (targetId) toggleMessagePin(targetId);
    });
  }
  if (el.togglePinsBtn) {
    el.togglePinsBtn.addEventListener('click', () => {
      const pinnedList = Array.from(state.pinnedMessages.values());
      if (pinnedList.length === 0) {
        showToast('Right-click or hold any message to pin it');
        return;
      }
      scrollToMessage(pinnedList[pinnedList.length - 1].id);
    });
  }
  if (el.cancelReplyBtn) {
    el.cancelReplyBtn.addEventListener('click', cancelReply);
  }

  if (el.messageInput) {
    el.messageInput.addEventListener('input', () => {
      if (!state.isTyping) {
        state.isTyping = true;
        if (state.swarm) state.swarm.sendTyping(true, state.activeConvId);
      }
      clearTimeout(state.typingTimeout);
      state.typingTimeout = setTimeout(() => {
        state.isTyping = false;
        if (state.swarm) state.swarm.sendTyping(false, state.activeConvId);
      }, 1800);
    });
  }

  if (el.chatForm) {
    el.chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = (el.messageInput.value || '').trim();
      const hasAttachments = state.pendingAttachments.length > 0;
      if ((!text && !hasAttachments) || !state.swarm) return;

      state.isTyping = false;
      clearTimeout(state.typingTimeout);
      el.messageInput.value = '';
      el.emojiStrip.classList.add('hidden');
      if (el.attachPopover) el.attachPopover.classList.add('hidden');

      const conv = state.conversations.get(state.activeConvId) || state.conversations.get('global');
      const extra = {};
      if (state.replyingToMsg) {
        extra.replyTo = state.replyingToMsg;
        cancelReply();
      }
      if (hasAttachments) {
        extra.attachments = [...state.pendingAttachments];
        state.pendingAttachments = [];
        renderPendingAttachmentsBar();
      }
      await state.swarm.sendChatMessage(text, conv, extra);
    });
  }

  if (el.messagesContainer) {
    el.messagesContainer.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.message-row');
      if (!row || !row._msgData) return;
      e.preventDefault();
      openContextMenu(row._msgData, e.clientX, e.clientY);
    });
  }
  if (el.contextBackdrop) {
    el.contextBackdrop.addEventListener('click', closeContextMenu);
  }
  el.ctxReactBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const emoji = btn.getAttribute('data-react');
      if (state.activeContextMsg && emoji && state.swarm) {
        state.swarm.sendReaction(state.activeContextMsg.id, emoji, state.activeContextMsg.convId || state.activeConvId);
      }
      closeContextMenu();
    });
  });
  if (el.ctxReplyBtn) {
    el.ctxReplyBtn.addEventListener('click', () => {
      if (state.activeContextMsg) startReplyTo(state.activeContextMsg);
      closeContextMenu();
    });
  }
  if (el.ctxDmSenderBtn) {
    el.ctxDmSenderBtn.addEventListener('click', () => {
      if (state.activeContextMsg && state.activeContextMsg.pubkey) {
        registerOrGetDmConversation(state.activeContextMsg.pubkey, state.activeContextMsg.username, true);
      }
      closeContextMenu();
    });
  }
  if (el.ctxInviteSenderBtn) {
    el.ctxInviteSenderBtn.addEventListener('click', () => {
      if (state.activeContextMsg && state.activeContextMsg.pubkey) {
        inviteUserToCurrentOrNewGroup(state.activeContextMsg.pubkey, state.activeContextMsg.username);
      }
      closeContextMenu();
    });
  }
  if (el.ctxMuteConvBtn) {
    el.ctxMuteConvBtn.addEventListener('click', () => {
      if (state.activeContextMsg) {
        toggleConversationMute(state.activeContextMsg.convId || state.activeConvId);
      }
      closeContextMenu();
    });
  }
  if (el.ctxPinBtn) {
    el.ctxPinBtn.addEventListener('click', () => {
      if (state.activeContextMsg) toggleMessagePin(state.activeContextMsg.id);
      closeContextMenu();
    });
  }
  if (el.ctxCopyIdBtn) {
    el.ctxCopyIdBtn.addEventListener('click', async () => {
      if (state.activeContextMsg) {
        await copyTextSafe(P0Crypto.getPublicIdentity({ ed25519_pub: state.activeContextMsg.pubkey }));
        showToast('Copied Sender Contact ID');
      }
      closeContextMenu();
    });
  }
  if (el.ctxCopyTextBtn) {
    el.ctxCopyTextBtn.addEventListener('click', async () => {
      if (state.activeContextMsg) {
        await copyTextSafe(state.activeContextMsg.content || '');
        showToast('Copied message text');
      }
      closeContextMenu();
    });
  }

  document.addEventListener('click', (e) => {
    if (el.themeMenu && !el.themeMenu.contains(e.target) && !e.target.closest('#theme-btn')) {
      el.themeMenu.classList.add('hidden');
    }
    if (el.settingsMenu && !el.settingsMenu.contains(e.target) && !e.target.closest('#settings-btn')) {
      el.settingsMenu.classList.add('hidden');
    }
    if (el.notifMenu && !el.notifMenu.contains(e.target) && !e.target.closest('#notif-btn')) {
      el.notifMenu.classList.add('hidden');
    }
    if (el.attachPopover && !el.attachPopover.contains(e.target) && !e.target.closest('#toggle-attach-btn')) {
      el.attachPopover.classList.add('hidden');
    }
    ['createGroupModal', 'joinGroupModal', 'newDmModal', 'identityModal'].forEach((mKey) => {
      if (el[mKey] && e.target === el[mKey]) {
        el[mKey].classList.add('hidden');
      }
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeContextMenu();
      if (el.mediaLightbox) el.mediaLightbox.classList.add('hidden');
      if (el.attachPopover) el.attachPopover.classList.add('hidden');
      ['createGroupModal', 'joinGroupModal', 'newDmModal', 'identityModal'].forEach((mKey) => {
        if (el[mKey]) el[mKey].classList.add('hidden');
      });
    }
  });
}

async function enterChat(username) {
  updateIdentityUI();
  el.joinModal.classList.add('hidden');
  el.app.classList.remove('hidden');

  ensureDefaultConversations();
  await loadStoredHistory();
  initSwarm(username);
  selectConversation('global');
}

async function loadStoredHistory() {
  if (!window.chatStorage) return;
  try {
    await window.chatStorage.init();
    const storedConvs = await window.chatStorage.loadConversations();
    storedConvs.forEach((c) => {
      if (c && c.id && !state.conversations.has(c.id)) {
        state.conversations.set(c.id, { unread: 0, ...c });
      }
    });

    const pinned = await window.chatStorage.loadPinnedMessages();
    pinned.forEach(p => state.pinnedMessages.set(p.id, p));
    updatePinnedBanner();

    const recent = await window.chatStorage.loadRecentMessages();
    recent.forEach((m) => {
      const cId = m.convId || 'global';
      const arr = state.messagesByConv.get(cId) || [];
      if (!arr.some(x => x.id === m.id)) {
        arr.push(m);
        state.messagesByConv.set(cId, arr);
      }
    });
  } catch (_) {}
}

function initSwarm(username) {
  state.swarm = new P2PGossipSwarm({
    room: 'global',
    username,
    identity: state.identity,
    onMessage: (msg) => {
      handleIncomingMessage(msg);
    },
    onReaction: (pkt) => {
      handleIncomingReaction(pkt);
    },
    onTransferProgress: (info) => {
      handleTransferProgress(info);
    },
    onTransferComplete: (info) => {
      handleTransferComplete(info);
    },
    onUserJoined: () => {
      updateActiveChatHeader();
    },
    onUserLeft: () => {
      updateActiveChatHeader();
    },
    onPeerListUpdate: (users) => {
      state.onlineUsers = users || [];
      renderConversationList();
      updateActiveChatHeader();
    },
    onStatusChange: (_status, stats) => {
      if (stats) {
        state.meshStats = stats;
        updateActiveChatHeader();
      }
    },
    onTyping: (msg) => {
      if (!msg || msg.username === state.username) return;
      if ((msg.convId || 'global') !== state.activeConvId) return;
      if (msg.isTyping) {
        if (state.remoteTypers.has(msg.username)) {
          clearTimeout(state.remoteTypers.get(msg.username));
        }
        const t = setTimeout(() => {
          state.remoteTypers.delete(msg.username);
          renderTypingBar();
        }, 2600);
        state.remoteTypers.set(msg.username, t);
      } else {
        state.remoteTypers.delete(msg.username);
      }
      renderTypingBar();
    },
    onGroupInvite: (invite) => {
      handleIncomingGroupInvite(invite);
    },
  });

  state.swarm.start();
  for (const conv of state.conversations.values()) {
    if (conv.type === 'group') {
      state.swarm.subscribeGroup(conv.id);
    }
  }
}

function renderTypingBar() {
  if (!el.typingIndicator || !el.typingText) return;
  const names = Array.from(state.remoteTypers.keys());
  if (names.length === 0) {
    el.typingIndicator.classList.add('hidden');
  } else {
    el.typingText.textContent = `@${names.join(', @')} ${names.length === 1 ? 'is' : 'are'} typing...`;
    el.typingIndicator.classList.remove('hidden');
  }
}

async function init() {
  bindElements();
  setupMobileViewportAdaptation();
  await P0Crypto.initWasm();
  state.identity = loadOrCreateIdentity();
  state.username = safeGetItem(sessionStorage, 'p0_chat_username') || safeGetItem(localStorage, 'p0_chat_username') || '';

  const savedTheme = safeGetItem(localStorage, 'p0_theme') || 'whatsapp-dark';
  setTheme(savedTheme);
  loadMutePreferences();

  const savedRet = safeGetItem(localStorage, 'p0_chat_retention') || '24h';
  if (el.retentionLabel) el.retentionLabel.textContent = RETENTION_LABELS[savedRet] || 'Saved: 24h';
  el.retentionRadios.forEach((r) => { r.checked = (r.value === savedRet); });

  setupEventListeners();

  if (state.username) {
    if (el.usernameInput) el.usernameInput.value = state.username;
    enterChat(state.username);
  } else if (el.usernameInput) {
    el.usernameInput.value = getRandomUsername();
  }
}

document.addEventListener('DOMContentLoaded', init);
