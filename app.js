/**
 * Global Chat Application Logic - Instagram-Inspired Aesthetic
 * Supports Public & Private Identities (impersonation / account key export),
 * persistent local identity, right-click context menu, and custom message retention.
 */

const state = {
  identity: null,
  username: sessionStorage.getItem('p0_chat_username') || localStorage.getItem('p0_chat_username') || '',
  swarm: null,
  onlineUsers: [],
  isTyping: false,
  typingTimeout: null,
  remoteTypers: new Set(),
  pinnedMessages: new Map(), // msgId -> msgObject
  renderedMsgIds: new Set(),
  activeContextMsg: null,
};

const el = {
  joinModal: document.getElementById('join-modal'),
  joinForm: document.getElementById('join-form'),
  usernameInput: document.getElementById('username-input'),
  randomNameBtn: document.getElementById('random-name-btn'),
  toggleImportKeyBtn: document.getElementById('toggle-import-key-btn'),
  importKeyContainer: document.getElementById('import-key-container'),
  importKeyInput: document.getElementById('import-key-input'),
  joinBtn: document.getElementById('join-btn'),
  app: document.getElementById('app'),

  headerMemberCount: document.getElementById('header-member-count'),
  togglePinsBtn: document.getElementById('toggle-pins-btn'),
  pinBadge: document.getElementById('pin-badge'),

  settingsBtn: document.getElementById('settings-btn'),
  settingsMenu: document.getElementById('settings-menu'),
  retentionLabel: document.getElementById('retention-label'),
  retentionRadios: document.querySelectorAll('input[name="retention"]'),
  clearHistoryBtn: document.getElementById('clear-history-btn'),

  themeBtn: document.getElementById('theme-btn'),
  themeMenu: document.getElementById('theme-menu'),
  themeIcon: document.getElementById('theme-icon'),
  themeLabel: document.getElementById('theme-label'),
  themeButtons: document.querySelectorAll('.dropdown-theme-btn'),

  currentUserPill: document.getElementById('current-user-pill'),
  myAvatar: document.getElementById('my-avatar'),
  myUsername: document.getElementById('my-username'),
  myPublicIdShort: document.getElementById('my-public-id-short'),

  // Identity Modal
  identityModal: document.getElementById('identity-modal'),
  closeIdentityBtn: document.getElementById('close-identity-btn'),
  editUsernameInput: document.getElementById('edit-username-input'),
  saveUsernameBtn: document.getElementById('save-username-btn'),
  copyMyPubkeyBtn: document.getElementById('copy-my-pubkey-btn'),
  myPublicIdDisplay: document.getElementById('my-public-id-display'),
  toggleSecretVisibilityBtn: document.getElementById('toggle-secret-visibility-btn'),
  copyMyPrivkeyBtn: document.getElementById('copy-my-privkey-btn'),
  myPrivateIdDisplay: document.getElementById('my-private-id-display'),
  switchPrivkeyInput: document.getElementById('switch-privkey-input'),
  switchPrivkeyBtn: document.getElementById('switch-privkey-btn'),
  generateNewIdBtn: document.getElementById('generate-new-id-btn'),

  // Message Context Menu (Right Click)
  messageContextMenu: document.getElementById('message-context-menu'),
  ctxAvatar: document.getElementById('ctx-avatar'),
  ctxUsername: document.getElementById('ctx-username'),
  ctxYouTag: document.getElementById('ctx-you-tag'),
  ctxUserId: document.getElementById('ctx-user-id'),
  ctxCopyIdBtn: document.getElementById('ctx-copy-id-btn'),
  ctxPinBtn: document.getElementById('ctx-pin-btn'),
  ctxPinIcon: document.getElementById('ctx-pin-icon'),
  ctxPinLabel: document.getElementById('ctx-pin-label'),
  ctxCopyTextBtn: document.getElementById('ctx-copy-text-btn'),

  toggleSidebarBtn: document.getElementById('toggle-sidebar-btn'),
  closeSidebarBtn: document.getElementById('close-sidebar-btn'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
  roomHeaderClickable: document.getElementById('room-header-clickable'),
  contextBackdrop: document.getElementById('context-backdrop'),
  appSidebar: document.getElementById('app-sidebar'),
  onlineCounter: document.getElementById('online-counter'),
  userSearch: document.getElementById('user-search'),
  userList: document.getElementById('user-list'),

  pinnedBanner: document.getElementById('pinned-banner'),
  pinnedText: document.getElementById('pinned-text'),
  unpinCurrentBtn: document.getElementById('unpin-current-btn'),

  messagesContainer: document.getElementById('messages-container'),
  typingIndicator: document.getElementById('typing-indicator'),
  typingText: document.getElementById('typing-text'),
  chatForm: document.getElementById('chat-form'),
  messageInput: document.getElementById('message-input'),
  sendBtn: document.getElementById('send-btn'),
  toast: document.getElementById('toast'),
};

const RANDOM_NAMES = [
  'Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Avery',
  'Sam', 'Logan', 'Quinn', 'Harper', 'Rowan', 'Dakota', 'Skyler',
  'Chris', 'Jamie', 'Robin', 'Sydney', 'Cameron', 'Jesse'
];

function getRandomUsername() {
  const name = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
  const num = Math.floor(10 + Math.random() * 90);
  return `${name}${num}`;
}

function showToast(msg) {
  if (!el.toast) return;
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  setTimeout(() => el.toast.classList.remove('show'), 2500);
}

// ---------------------------------------------------------------------------
// Identity Management (Public vs Private / Impersonation)
// ---------------------------------------------------------------------------
function loadOrCreateIdentity() {
  const saved = localStorage.getItem('p0_user_identity');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.ed25519_pub && parsed.ed25519_priv) {
        return parsed;
      }
    } catch (_) {}
  }

  const fresh = P0Crypto.generateIdentity();
  localStorage.setItem('p0_user_identity', JSON.stringify(fresh));
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
}

function switchIdentity(token) {
  const imported = P0Crypto.importIdentity(token);
  if (!imported) {
    showToast('Invalid Private Identity key');
    return false;
  }
  state.identity = imported;
  localStorage.setItem('p0_user_identity', JSON.stringify(imported));
  updateIdentityUI();

  if (state.swarm) {
    state.swarm.identity = imported;
    state.swarm.broadcastDiscover();
  }

  // Re-align chat feed: messages from this imported identity move to the right side!
  reRenderChatFeed();
  renderUserList();

  if (el.identityModal) el.identityModal.classList.add('hidden');
  showToast(`Switched identity to ${P0Crypto.formatPublicId(imported.ed25519_pub)}`);
  return true;
}

function generateFreshIdentity() {
  const fresh = P0Crypto.generateIdentity();
  state.identity = fresh;
  localStorage.setItem('p0_user_identity', JSON.stringify(fresh));
  updateIdentityUI();

  if (state.swarm) {
    state.swarm.identity = fresh;
    state.swarm.broadcastDiscover();
  }

  reRenderChatFeed();
  renderUserList();
  showToast('Generated fresh identity');
}

function updateUsername(newHandle) {
  newHandle = (newHandle || '').trim().replace(/^@/, '');
  if (!newHandle) return;
  state.username = newHandle;
  sessionStorage.setItem('p0_chat_username', newHandle);
  localStorage.setItem('p0_chat_username', newHandle);

  if (el.myUsername) el.myUsername.textContent = newHandle;
  if (el.myAvatar) el.myAvatar.textContent = newHandle.charAt(0).toUpperCase();

  if (state.swarm) {
    state.swarm.username = newHandle;
    state.swarm.broadcastDiscover();
  }

  renderUserList();
  showToast(`Username updated to @${newHandle}`);
}

function reRenderChatFeed() {
  const myPub = state.identity ? state.identity.ed25519_pub : '';
  const rows = el.messagesContainer.querySelectorAll('.message-row');
  rows.forEach((row) => {
    if (row._msgData) {
      const isMe = (row._msgData.pubkey === myPub);
      row.classList.toggle('is-me', isMe);
    }
  });
}

function initIdentityModal() {
  if (el.currentUserPill) {
    el.currentUserPill.addEventListener('click', () => {
      updateIdentityUI();
      el.identityModal.classList.remove('hidden');
    });
  }

  if (el.closeIdentityBtn) {
    el.closeIdentityBtn.addEventListener('click', () => {
      el.identityModal.classList.add('hidden');
    });
  }

  if (el.saveUsernameBtn) {
    el.saveUsernameBtn.addEventListener('click', () => {
      updateUsername(el.editUsernameInput.value);
    });
  }

  if (el.editUsernameInput) {
    el.editUsernameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        updateUsername(el.editUsernameInput.value);
      }
    });
  }

  if (el.copyMyPubkeyBtn) {
    el.copyMyPubkeyBtn.addEventListener('click', async () => {
      const pubId = P0Crypto.getPublicIdentity(state.identity);
      try {
        await navigator.clipboard.writeText(pubId);
        showToast('Public Identity copied to clipboard');
      } catch (_) {
        showToast('Unable to copy');
      }
    });
  }

  if (el.toggleSecretVisibilityBtn) {
    el.toggleSecretVisibilityBtn.addEventListener('click', () => {
      if (el.myPrivateIdDisplay.type === 'password') {
        el.myPrivateIdDisplay.type = 'text';
        el.toggleSecretVisibilityBtn.textContent = '🔒 Hide';
      } else {
        el.myPrivateIdDisplay.type = 'password';
        el.toggleSecretVisibilityBtn.textContent = '👁️ Reveal';
      }
    });
  }

  if (el.copyMyPrivkeyBtn) {
    el.copyMyPrivkeyBtn.addEventListener('click', async () => {
      const privId = P0Crypto.getPrivateIdentity(state.identity);
      try {
        await navigator.clipboard.writeText(privId);
        showToast('Private Identity copied! Keep it secret.');
      } catch (_) {
        showToast('Unable to copy');
      }
    });
  }

  if (el.switchPrivkeyBtn) {
    el.switchPrivkeyBtn.addEventListener('click', () => {
      const token = el.switchPrivkeyInput.value.trim();
      if (!token) return;
      if (switchIdentity(token)) {
        el.switchPrivkeyInput.value = '';
      }
    });
  }

  if (el.generateNewIdBtn) {
    el.generateNewIdBtn.addEventListener('click', () => {
      if (confirm('Generate a new identity? You will have a fresh public ID.')) {
        generateFreshIdentity();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Right-Click Context Menu for Chat Messages
// ---------------------------------------------------------------------------
function initContextMenu() {
  // Prevent contextmenu and open custom Instagram-style menu
  el.messagesContainer.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.message-row');
    if (!row || !row._msgData) return;

    e.preventDefault();
    openContextMenu(row._msgData, e.clientX, e.clientY);
  });

  // Long-press detection for mobile touch devices
  let touchTimer = null;
  let startX = 0;
  let startY = 0;

  el.messagesContainer.addEventListener('touchstart', (e) => {
    const row = e.target.closest('.message-row');
    if (!row || !row._msgData) return;
    const touch = e.touches[0];
    if (!touch) return;

    startX = touch.clientX;
    startY = touch.clientY;

    touchTimer = setTimeout(() => {
      if (navigator.vibrate) {
        try { navigator.vibrate(25); } catch (_) {}
      }
      openContextMenu(row._msgData, startX, startY);
    }, 450);
  }, { passive: true });

  el.messagesContainer.addEventListener('touchend', () => clearTimeout(touchTimer));
  el.messagesContainer.addEventListener('touchcancel', () => clearTimeout(touchTimer));
  el.messagesContainer.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    if (touch && (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10)) {
      clearTimeout(touchTimer);
    }
  }, { passive: true });

  // Context Menu Actions
  if (el.ctxCopyIdBtn) {
    el.ctxCopyIdBtn.addEventListener('click', async () => {
      if (!state.activeContextMsg) return;
      const pubId = P0Crypto.getPublicIdentity({ ed25519_pub: state.activeContextMsg.pubkey });
      try {
        await navigator.clipboard.writeText(pubId);
        showToast(`Copied Public Identity (${P0Crypto.formatPublicId(state.activeContextMsg.pubkey)})`);
      } catch (_) {
        showToast('Unable to copy');
      }
      closeContextMenu();
    });
  }

  if (el.ctxPinBtn) {
    el.ctxPinBtn.addEventListener('click', () => {
      if (!state.activeContextMsg) return;
      toggleMessagePin(state.activeContextMsg.id);
      closeContextMenu();
    });
  }

  if (el.ctxCopyTextBtn) {
    el.ctxCopyTextBtn.addEventListener('click', async () => {
      if (!state.activeContextMsg) return;
      try {
        await navigator.clipboard.writeText(state.activeContextMsg.content);
        showToast('Message text copied to clipboard');
      } catch (_) {
        showToast('Unable to copy');
      }
      closeContextMenu();
    });
  }

  // Close context menu on backdrop click, document click, or escape
  if (el.contextBackdrop) {
    el.contextBackdrop.addEventListener('click', closeContextMenu);
    el.contextBackdrop.addEventListener('touchstart', closeContextMenu, { passive: true });
  }

  document.addEventListener('click', (e) => {
    if (el.messageContextMenu && !el.messageContextMenu.contains(e.target) && !e.target.closest('.message-row')) {
      closeContextMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeContextMenu();
      if (el.identityModal) el.identityModal.classList.add('hidden');
    }
  });

  window.addEventListener('resize', () => {
    if (state.activeContextMsg) closeContextMenu();
  });
}

function openContextMenu(msg, clientX, clientY) {
  state.activeContextMsg = msg;
  const isMe = state.identity && (msg.pubkey === state.identity.ed25519_pub);

  el.ctxAvatar.textContent = (msg.username || '?').charAt(0).toUpperCase();
  el.ctxUsername.textContent = msg.username || 'Anonymous';
  el.ctxYouTag.classList.toggle('hidden', !isMe);

  const formattedPub = P0Crypto.formatPublicId(msg.pubkey);
  el.ctxUserId.textContent = formattedPub;
  el.ctxUserId.title = P0Crypto.getPublicIdentity({ ed25519_pub: msg.pubkey });

  const isPinned = state.pinnedMessages.has(msg.id);
  el.ctxPinLabel.textContent = isPinned ? 'Unpin Message' : 'Pin Message';

  const isMobile = window.innerWidth <= 640;

  if (isMobile) {
    if (el.contextBackdrop) {
      el.contextBackdrop.classList.remove('hidden');
      requestAnimationFrame(() => el.contextBackdrop.classList.add('active'));
    }
    el.messageContextMenu.style.left = '';
    el.messageContextMenu.style.top = '';
  } else {
    if (el.contextBackdrop) {
      el.contextBackdrop.classList.add('hidden');
      el.contextBackdrop.classList.remove('active');
    }
    const menuWidth = 240;
    const menuHeight = 175;
    const posX = Math.min(clientX || 20, window.innerWidth - menuWidth - 12);
    const posY = Math.min(clientY || 20, window.innerHeight - menuHeight - 12);

    el.messageContextMenu.style.left = `${Math.max(10, posX)}px`;
    el.messageContextMenu.style.top = `${Math.max(10, posY)}px`;
  }

  el.messageContextMenu.classList.remove('hidden');
}

function closeContextMenu() {
  if (el.messageContextMenu) {
    el.messageContextMenu.classList.add('hidden');
  }
  if (el.contextBackdrop) {
    el.contextBackdrop.classList.remove('active');
    setTimeout(() => {
      if (!state.activeContextMsg && el.contextBackdrop) {
        el.contextBackdrop.classList.add('hidden');
      }
    }, 200);
  }
  state.activeContextMsg = null;
}

// ---------------------------------------------------------------------------
// Appearance & Themes
// ---------------------------------------------------------------------------
const THEME_CONFIG = {
  dark: { icon: '🌙', label: 'Dark' },
  slate: { icon: '🌌', label: 'Slate' },
  light: { icon: '☀️', label: 'Light' },
  cyber: { icon: '⚡', label: 'Neon' },
};

function setTheme(theme) {
  if (!THEME_CONFIG[theme]) theme = 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('p0_theme', theme);
  if (el.themeIcon) el.themeIcon.textContent = THEME_CONFIG[theme].icon;
  if (el.themeLabel) el.themeLabel.textContent = THEME_CONFIG[theme].label;
}

function initTheme() {
  const saved = localStorage.getItem('p0_theme') || 'dark';
  setTheme(saved);

  if (el.themeBtn) {
    el.themeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      el.themeMenu.classList.toggle('hidden');
      if (el.settingsMenu) el.settingsMenu.classList.add('hidden');
    });
  }

  el.themeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.getAttribute('data-theme');
      setTheme(theme);
      el.themeMenu.classList.add('hidden');
      showToast(`Theme changed to ${THEME_CONFIG[theme].label}`);
    });
  });
}

// ---------------------------------------------------------------------------
// History Retention Settings
// ---------------------------------------------------------------------------
const RETENTION_LABELS = {
  none: 'Session Only',
  '1h': 'Saved: 1h',
  '24h': 'Saved: 24h',
  '7d': 'Saved: 7d',
};

function initRetention() {
  const currentRetention = localStorage.getItem('p0_chat_retention') || '24h';
  el.retentionRadios.forEach((radio) => {
    radio.checked = radio.value === currentRetention;
    radio.addEventListener('change', () => {
      if (radio.checked) {
        const val = radio.value;
        if (window.chatStorage) {
          window.chatStorage.setRetention(val);
        }
        if (el.retentionLabel) {
          el.retentionLabel.textContent = RETENTION_LABELS[val] || 'Saved: 24h';
        }
        el.settingsMenu.classList.add('hidden');
        showToast(val === 'none' ? 'Chat retention: Session only' : `Messages kept for ${val === '1h' ? '1 hour' : val === '24h' ? '24 hours' : '7 days'}`);
      }
    });
  });

  if (el.retentionLabel) {
    el.retentionLabel.textContent = RETENTION_LABELS[currentRetention] || 'Saved: 24h';
  }

  if (el.settingsBtn) {
    el.settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      el.settingsMenu.classList.toggle('hidden');
      if (el.themeMenu) el.themeMenu.classList.add('hidden');
    });
  }

  if (el.clearHistoryBtn) {
    el.clearHistoryBtn.addEventListener('click', async () => {
      if (window.chatStorage) {
        await window.chatStorage.clearAll();
      }
      state.pinnedMessages.clear();
      state.renderedMsgIds.clear();
      updatePinnedBanner();

      const welcome = el.messagesContainer.querySelector('.welcome-card');
      el.messagesContainer.innerHTML = '';
      if (welcome) el.messagesContainer.appendChild(welcome);

      el.settingsMenu.classList.add('hidden');
      showToast('Chat history cleared');
    });
  }
}

// Close menus when clicking outside
document.addEventListener('click', (e) => {
  if (el.themeMenu && !el.themeMenu.contains(e.target) && e.target !== el.themeBtn) {
    el.themeMenu.classList.add('hidden');
  }
  if (el.settingsMenu && !el.settingsMenu.contains(e.target) && e.target !== el.settingsBtn) {
    el.settingsMenu.classList.add('hidden');
  }
  if (el.identityModal && e.target === el.identityModal) {
    el.identityModal.classList.add('hidden');
  }
});

// ---------------------------------------------------------------------------
// Pinned Messages Management
// ---------------------------------------------------------------------------
function updatePinnedBanner() {
  const pinnedList = Array.from(state.pinnedMessages.values());
  const count = pinnedList.length;

  if (count === 0) {
    el.pinnedBanner.classList.add('hidden');
    el.pinBadge.classList.add('hidden');
    el.pinBadge.textContent = '0';
  } else {
    el.pinBadge.textContent = count;
    el.pinBadge.classList.remove('hidden');
    el.pinnedBanner.classList.remove('hidden');

    const latest = pinnedList[pinnedList.length - 1];
    el.pinnedText.textContent = `${latest.username}: ${latest.content}`;
    el.pinnedBanner.dataset.targetId = latest.id;
  }
}

async function toggleMessagePin(msgId) {
  const msgElement = document.getElementById(`msg-${msgId}`);
  const isCurrentlyPinned = state.pinnedMessages.has(msgId);
  const newPinnedState = !isCurrentlyPinned;

  if (newPinnedState) {
    let msgObj = null;
    if (msgElement && msgElement._msgData) {
      msgObj = { ...msgElement._msgData, pinned: true };
    } else {
      msgObj = { id: msgId, pinned: true, content: '', username: '' };
    }
    state.pinnedMessages.set(msgId, msgObj);
  } else {
    state.pinnedMessages.delete(msgId);
  }

  if (window.chatStorage) {
    await window.chatStorage.togglePin(msgId, newPinnedState);
  }

  // Update DOM message tag
  if (msgElement) {
    if (msgElement._msgData) {
      msgElement._msgData.pinned = newPinnedState;
    }
    const pinTag = msgElement.querySelector('.message-pinned-tag');
    if (newPinnedState) {
      if (!pinTag) {
        const header = msgElement.querySelector('.message-header');
        if (header) {
          const tag = document.createElement('span');
          tag.className = 'message-pinned-tag';
          tag.textContent = '📌 Pinned';
          header.appendChild(tag);
        }
      }
    } else {
      if (pinTag) pinTag.remove();
    }
  }

  updatePinnedBanner();
  showToast(newPinnedState ? 'Message pinned to top' : 'Message unpinned');
}

function scrollToMessage(msgId) {
  const msgEl = document.getElementById(`msg-${msgId}`);
  if (msgEl) {
    msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    msgEl.classList.remove('highlight-pulse');
    void msgEl.offsetWidth;
    msgEl.classList.add('highlight-pulse');
    setTimeout(() => msgEl.classList.remove('highlight-pulse'), 1600);
  } else {
    showToast('Pinned message is not currently loaded');
  }
}

function initPinHandlers() {
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
        showToast('No pinned messages yet');
        return;
      }
      const latest = pinnedList[pinnedList.length - 1];
      scrollToMessage(latest.id);
    });
  }
}

// ---------------------------------------------------------------------------
// App Startup & Chat Flow
// ---------------------------------------------------------------------------
async function init() {
  await P0Crypto.initWasm();

  // Load persistent identity or create fresh
  state.identity = loadOrCreateIdentity();

  initTheme();
  initRetention();
  initPinHandlers();
  initIdentityModal();
  initContextMenu();
  setupEventListeners();

  if (state.username) {
    el.usernameInput.value = state.username;
    enterChat(state.username);
  } else {
    el.usernameInput.value = getRandomUsername();
  }
}

function handleJoinSubmit(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const handle = el.usernameInput.value.trim().replace(/^@/, '');
  if (!handle) return;

  // Check if user entered an account key on join
  if (el.importKeyInput && el.importKeyInput.value.trim()) {
    const imported = P0Crypto.importIdentity(el.importKeyInput.value.trim());
    if (imported) {
      state.identity = imported;
      localStorage.setItem('p0_user_identity', JSON.stringify(imported));
    }
  }

  state.username = handle;
  sessionStorage.setItem('p0_chat_username', handle);
  localStorage.setItem('p0_chat_username', handle);
  enterChat(handle);
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

  if (el.joinBtn) {
    el.joinBtn.addEventListener('click', handleJoinSubmit);
  }

  if (el.joinForm) {
    el.joinForm.addEventListener('submit', handleJoinSubmit);
  }

  if (el.usernameInput) {
    el.usernameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleJoinSubmit(e);
      }
    });
  }

  function openSidebar() {
    if (el.appSidebar) el.appSidebar.classList.add('open');
    if (el.sidebarBackdrop) {
      el.sidebarBackdrop.classList.remove('hidden');
      requestAnimationFrame(() => el.sidebarBackdrop.classList.add('active'));
    }
  }

  function closeSidebar() {
    if (el.appSidebar) el.appSidebar.classList.remove('open');
    if (el.sidebarBackdrop) {
      el.sidebarBackdrop.classList.remove('active');
      setTimeout(() => {
        if (el.sidebarBackdrop && !el.appSidebar.classList.contains('open')) {
          el.sidebarBackdrop.classList.add('hidden');
        }
      }, 250);
    }
  }

  if (el.toggleSidebarBtn) {
    el.toggleSidebarBtn.addEventListener('click', () => {
      if (el.appSidebar && el.appSidebar.classList.contains('open')) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });
  }

  if (el.roomHeaderClickable) {
    el.roomHeaderClickable.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        openSidebar();
      }
    });
  }

  if (el.closeSidebarBtn) {
    el.closeSidebarBtn.addEventListener('click', closeSidebar);
  }

  if (el.sidebarBackdrop) {
    el.sidebarBackdrop.addEventListener('click', closeSidebar);
    el.sidebarBackdrop.addEventListener('touchstart', closeSidebar, { passive: true });
  }

  // Smooth keyboard avoidance for iOS and Android
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (document.activeElement === el.messageInput) {
        setTimeout(() => {
          el.messagesContainer.scrollTop = el.messagesContainer.scrollHeight;
        }, 120);
      }
    });
  }

  if (el.userSearch) {
    el.userSearch.addEventListener('input', (e) => {
      renderUserList(e.target.value.toLowerCase());
    });
  }

  if (el.messageInput) {
    el.messageInput.addEventListener('input', () => {
      if (!state.isTyping) {
        state.isTyping = true;
        if (state.swarm) state.swarm.sendTyping(true);
      }
      clearTimeout(state.typingTimeout);
      state.typingTimeout = setTimeout(() => {
        state.isTyping = false;
        if (state.swarm) state.swarm.sendTyping(false);
      }, 2000);
    });
  }

  if (el.chatForm) {
    el.chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = el.messageInput.value.trim();
      if (!text || !state.swarm) return;

      state.isTyping = false;
      clearTimeout(state.typingTimeout);
      state.swarm.sendTyping(false);

      el.messageInput.value = '';

      await state.swarm.sendChatMessage(text);
    });
  }
}

async function enterChat(username) {
  el.myUsername.textContent = username;
  el.myAvatar.textContent = username.charAt(0).toUpperCase();

  updateIdentityUI();

  el.joinModal.classList.add('hidden');
  el.app.classList.remove('hidden');

  // Load saved history & pinned messages from IndexedDB
  await loadHistory();

  // Start peer messaging engine
  initSwarm(username);
}

async function loadHistory() {
  if (!window.chatStorage) return;
  try {
    await window.chatStorage.init();

    // 1. Load pinned messages
    const pinned = await window.chatStorage.loadPinnedMessages();
    pinned.forEach((p) => {
      state.pinnedMessages.set(p.id, p);
    });
    updatePinnedBanner();

    // 2. Load recent unexpired messages
    const recent = await window.chatStorage.loadRecentMessages();
    recent.forEach((m) => {
      renderChatMessage(m);
    });
  } catch (e) {
    console.warn('Error loading chat history:', e);
  }
}

function initSwarm(username) {
  state.swarm = new P2PGossipSwarm({
    room: 'global',
    username: username,
    identity: state.identity,
    maxNeighbors: 6,
    onMessage: (msg) => {
      if (window.chatStorage) {
        window.chatStorage.saveMessage(msg);
      }
      renderChatMessage(msg);
    },
    onUserJoined: (user) => {
      if (user.username !== state.username) {
        appendSystemMessage(`${user.username} joined the chat`);
      }
    },
    onUserLeft: (user) => {
      appendSystemMessage(`${user.username} left the chat`);
    },
    onPeerListUpdate: (users) => {
      state.onlineUsers = users;
      renderUserList();
    },
    onStatusChange: () => {},
    onTyping: (msg) => {
      handleRemoteTyping(msg);
    },
  });

  state.swarm.start();
  renderUserList();
  showToast(`Welcome to Global Chat, @${username}`);
}

function renderUserList(query = '') {
  el.userList.innerHTML = '';
  const myPub = state.identity ? state.identity.ed25519_pub : '';

  // Ensure current user is in list
  const users = [...state.onlineUsers];
  if (!users.some(u => u.pubkey === myPub || (u.username === state.username && !u.pubkey))) {
    users.unshift({
      username: state.username,
      pubkey: myPub,
      isMe: true,
    });
  }

  const filtered = users.filter((u) => {
    if (!query) return true;
    return (u.username || '').toLowerCase().includes(query.toLowerCase());
  });

  const totalCount = users.length;
  if (el.onlineCounter) el.onlineCounter.textContent = totalCount;
  if (el.headerMemberCount) {
    el.headerMemberCount.textContent = `${totalCount} ${totalCount === 1 ? 'Member' : 'Members'} Online`;
  }

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'user-list-item';
    empty.style.color = 'var(--text-dim)';
    empty.style.fontSize = '0.8rem';
    empty.textContent = query ? 'No matching members' : 'No members online';
    el.userList.appendChild(empty);
    return;
  }

  filtered.forEach((user) => {
    const isMe = (user.pubkey && user.pubkey === myPub) || user.isMe;
    const item = document.createElement('div');
    item.className = 'user-list-item';

    const shortId = P0Crypto.formatPublicId(user.pubkey);

    item.innerHTML = `
      <div class="user-avatar-wrap">
        <div class="avatar">${escapeHtml((user.username || '?').charAt(0).toUpperCase())}</div>
        <span class="user-online-dot"></span>
      </div>
      <div class="user-meta">
        <div class="user-name-line">
          <span class="user-item-name">${escapeHtml(user.username || 'Anonymous')}</span>
          ${isMe ? '<span class="user-you-tag">YOU</span>' : ''}
        </div>
        <div class="user-item-sub" style="font-size: 0.65rem; color: var(--text-dim); font-family: var(--font-mono);">${shortId}</div>
      </div>
    `;

    item.addEventListener('click', () => {
      const pubId = P0Crypto.getPublicIdentity({ ed25519_pub: user.pubkey });
      showToast(isMe ? `Your Public Identity: ${shortId}` : `@${user.username}: ${pubId}`);
    });

    el.userList.appendChild(item);
  });
}

function renderChatMessage(msg) {
  if (!msg.id) {
    msg.id = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
  }
  if (state.renderedMsgIds.has(msg.id)) return;
  state.renderedMsgIds.add(msg.id);

  if (msg.pinned) {
    state.pinnedMessages.set(msg.id, msg);
    updatePinnedBanner();
  }

  // Identity-based alignment: if public key matches our private identity, it's ON THE RIGHT!
  const myPub = state.identity ? state.identity.ed25519_pub : '';
  const isMe = (msg.pubkey && msg.pubkey === myPub) || (!!msg.isMe && !msg.pubkey);
  const timeStr = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const row = document.createElement('div');
  row.className = `message-row ${isMe ? 'is-me' : ''}`;
  row.id = `msg-${msg.id}`;
  row._msgData = msg;

  const isPinned = state.pinnedMessages.has(msg.id);

  row.innerHTML = `
    <div class="avatar">${escapeHtml((msg.username || '?').charAt(0).toUpperCase())}</div>
    <div class="message-content-wrap">
      <div class="message-header">
        <span class="message-author">${escapeHtml(msg.username || 'Anonymous')}</span>
        <span class="message-time">${timeStr}</span>
        ${isPinned ? '<span class="message-pinned-tag">📌 Pinned</span>' : ''}
      </div>
      <div class="message-bubble" title="Right-click for options">${escapeHtml(msg.content)}</div>
    </div>
  `;

  el.messagesContainer.appendChild(row);
  scrollToBottom();
}

function appendSystemMessage(text) {
  const row = document.createElement('div');
  row.className = 'system-event-row';
  row.innerHTML = `<span class="system-event-pill">${escapeHtml(text)}</span>`;
  el.messagesContainer.appendChild(row);
  scrollToBottom();
}

function handleRemoteTyping(msg) {
  if (msg.username === state.username) return;
  if (msg.isTyping) {
    state.remoteTypers.add(msg.username);
  } else {
    state.remoteTypers.delete(msg.username);
  }

  if (state.remoteTypers.size > 0) {
    const names = Array.from(state.remoteTypers).join(', ');
    el.typingText.textContent = `${names} ${state.remoteTypers.size === 1 ? 'is' : 'are'} typing...`;
    el.typingIndicator.style.display = 'flex';
  } else {
    el.typingIndicator.style.display = 'none';
  }
}

function scrollToBottom() {
  el.messagesContainer.scrollTop = el.messagesContainer.scrollHeight;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

document.addEventListener('DOMContentLoaded', init);
