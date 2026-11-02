/**
 * Neon Tag Arena — P2P Multiplayer Web Game
 * Zero-Backend Architecture powered by Trystero (BitTorrent strategy)
 */

import { joinRoom } from 'https://esm.sh/trystero@0.20.0/torrent';

// --------------------------------------------------
// CONFIG & CONSTANTS
// --------------------------------------------------
const APP_ID = 'neon-tag-arena-v1';
const ARENA_WIDTH = 2400;
const ARENA_HEIGHT = 1600;
const PLAYER_RADIUS = 22;
const BASE_SPEED = 240; // px per second
const DASH_SPEED = 500;
const DASH_DURATION = 0.25; // seconds
const DASH_COOLDOWN = 2.0; // seconds
const NETWORK_TICK_RATE = 25; // 25 updates/sec (~40ms)
const TAG_COOLDOWN_TIME = 3.0; // seconds after being tagged before you can tag back

const COLOR_PALETTE = [
  '#00f0ff', '#ff007b', '#00ff88', '#ffe600',
  '#b000ff', '#ff7700', '#00e1d9', '#ff3366'
];

// --------------------------------------------------
// GAME STATE
// --------------------------------------------------
const state = {
  roomId: 'lobby',
  myId: null,
  localPlayer: {
    id: null,
    name: 'Player',
    color: COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)],
    x: ARENA_WIDTH / 2 + (Math.random() * 200 - 100),
    y: ARENA_HEIGHT / 2 + (Math.random() * 200 - 100),
    vx: 0,
    vy: 0,
    isIt: false,
    score: 0,
    dashing: false,
    dashTimer: 0,
    dashCooldown: 0,
    bubble: null,
    bubbleTimer: 0
  },
  peers: new Map(), // peerId -> { id, name, color, x, y, targetX, targetY, isIt, score, bubble, bubbleTimer, lastPing, ping }
  obstacles: [
    { x: 500, y: 400, w: 200, h: 80 },
    { x: 900, y: 700, w: 100, h: 260 },
    { x: 1500, y: 400, w: 140, h: 140 },
    { x: 1700, y: 1000, w: 220, h: 90 },
    { x: 700, y: 1100, w: 260, h: 80 },
    { x: 1200, y: 1150, w: 90, h: 220 },
    { x: 1200, y: 250, w: 80, h: 200 }
  ],
  particles: [],
  tagCooldown: 0,
  room: null,
  actions: {},
  keys: { w: false, a: false, s: false, d: false, space: false },
  touchVector: { x: 0, y: 0 }
};

// --------------------------------------------------
// SOUND EFFECTS (Web Audio API Synthesizer)
// --------------------------------------------------
class SoundFX {
  constructor() {
    this.ctx = null;
  }
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }
  playTag() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(150, this.ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.3);
  }
  playDash() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, this.ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.15);
  }
  playPop() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
  }
}
const sfx = new SoundFX();

// --------------------------------------------------
// DOM ELEMENTS & INITIAL SETUP
// --------------------------------------------------
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const connBadge = document.getElementById('connBadge');
const connLabel = document.getElementById('connLabel');
const pingVal = document.getElementById('pingVal');
const peerCountDisplay = document.getElementById('peerCount');
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const copyRoomBtn = document.getElementById('copyRoomBtn');
const changeRoomBtn = document.getElementById('changeRoomBtn');
const tagStatusBanner = document.getElementById('tagStatusBanner');
const tagStatusText = document.getElementById('tagStatusText');
const playerList = document.getElementById('playerList');
const chatInput = document.getElementById('chatInput');
const roomModal = document.getElementById('roomModal');
const roomInput = document.getElementById('roomInput');
const nameInput = document.getElementById('nameInput');
const joinModalBtn = document.getElementById('joinModalBtn');
const cancelModalBtn = document.getElementById('cancelModalBtn');
const toastContainer = document.getElementById('toastContainer');

function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// --------------------------------------------------
// ROOM & NETWORKING (TRYSTERO)
// --------------------------------------------------
function getRoomFromHash() {
  const hash = window.location.hash.replace('#', '').trim();
  return hash.length > 0 ? hash : 'lobby';
}

function initMultiplayer() {
  state.roomId = getRoomFromHash();
  roomCodeDisplay.textContent = `#${state.roomId}`;

  // Read saved nickname if any
  const savedName = localStorage.getItem('neon_tag_name');
  if (savedName) state.localPlayer.name = savedName;

  // Initialize Trystero Room
  try {
    const room = joinRoom({ appId: APP_ID }, state.roomId);
    state.room = room;

    connBadge.className = 'status-badge connecting';
    connLabel.textContent = 'Connecting...';

    // Core Trystero Actions
    const [sendPos, getPos] = room.makeAction('pos');
    const [sendTag, getTag] = room.makeAction('tag');
    const [sendChat, getChat] = room.makeAction('chat');
    const [sendPing, getPing] = room.makeAction('ping');
    const [sendPong, getPong] = room.makeAction('pong');
    const [sendSync, getSync] = room.makeAction('sync');

    state.actions = { sendPos, sendTag, sendChat, sendPing, sendPong, sendSync };

    // When a new peer joins
    room.onPeerJoin(peerId => {
      connBadge.className = 'status-badge connected';
      connLabel.textContent = 'Connected (P2P)';

      // Host election: lexicographically lowest peerId determines default 'IT' if nobody is IT
      state.peers.set(peerId, {
        id: peerId,
        name: 'Guest',
        color: COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)],
        x: ARENA_WIDTH / 2,
        y: ARENA_HEIGHT / 2,
        targetX: ARENA_WIDTH / 2,
        targetY: ARENA_HEIGHT / 2,
        isIt: false,
        score: 0,
        bubble: null,
        bubbleTimer: 0,
        ping: 0
      });

      updatePeerCount();
      showToast(`Peer joined: ${peerId.slice(0, 5)}`);

      // Immediately send our state to the newcomer
      sendSync({
        name: state.localPlayer.name,
        color: state.localPlayer.color,
        isIt: state.localPlayer.isIt,
        score: state.localPlayer.score
      }, peerId);

      resolveTagRoleHost();
    });

    // When peer leaves
    room.onPeerLeave(peerId => {
      const peer = state.peers.get(peerId);
      const wasIt = peer ? peer.isIt : false;
      state.peers.delete(peerId);
      updatePeerCount();
      showToast(`Player left`);

      // If the person who was "IT" left, pick a new IT
      if (wasIt) {
        state.localPlayer.isIt = true;
        state.tagCooldown = TAG_COOLDOWN_TIME;
        showToast('You are now IT! Chase the others!');
        broadcastTag(state.myId);
      }
      resolveTagRoleHost();
    });

    // Action listeners
    getPos((data, peerId) => {
      const peer = state.peers.get(peerId);
      if (peer) {
        peer.targetX = data.x;
        peer.targetY = data.y;
        if (data.name) peer.name = data.name;
        if (data.color) peer.color = data.color;
        if (typeof data.isIt === 'boolean') peer.isIt = data.isIt;
        if (data.score !== undefined) peer.score = data.score;
      }
    });

    getTag((data, peerId) => {
      handleTagEvent(data.taggedId, data.taggerId);
    });

    getChat((data, peerId) => {
      const peer = state.peers.get(peerId);
      if (peer) {
        peer.bubble = data.text;
        peer.bubbleTimer = 3.5;
        sfx.playPop();
      }
    });

    getSync((data, peerId) => {
      const peer = state.peers.get(peerId);
      if (peer) {
        peer.name = data.name;
        peer.color = data.color;
        peer.isIt = data.isIt;
        peer.score = data.score;
        updateLeaderboard();
      }
    });

    // Latency measurement (Ping/Pong)
    getPing((time, peerId) => {
      sendPong(time, peerId);
    });

    getPong((time, peerId) => {
      const rtt = Math.max(1, Math.round(performance.now() - time));
      const peer = state.peers.get(peerId);
      if (peer) peer.ping = rtt;
      pingVal.textContent = `${rtt} ms`;
    });

    // Ping peer every 4 seconds
    setInterval(() => {
      const peers = Array.from(state.peers.keys());
      if (peers.length > 0) {
        sendPing(performance.now(), peers[0]);
      } else {
        pingVal.textContent = '-- ms';
      }
    }, 4000);

  } catch (err) {
    console.error('Trystero Join Room Error:', err);
    connBadge.className = 'status-badge error';
    connLabel.textContent = 'Connection Error';
  }
}

function resolveTagRoleHost() {
  // If only 1 player, default them to IT
  if (state.peers.size === 0) {
    state.localPlayer.isIt = true;
    updateTagBanner();
    updateLeaderboard();
    return;
  }

  // Check if anyone is currently IT
  let hasIt = state.localPlayer.isIt;
  for (const peer of state.peers.values()) {
    if (peer.isIt) {
      hasIt = true;
      break;
    }
  }

  // If no one is IT, pick host (first lexicographically)
  if (!hasIt) {
    const allIds = [state.myId || 'me', ...state.peers.keys()].sort();
    if (allIds[0] === (state.myId || 'me')) {
      state.localPlayer.isIt = true;
      broadcastTag(state.myId);
    }
  }

  updateTagBanner();
  updateLeaderboard();
}

function updatePeerCount() {
  const count = state.peers.size + 1;
  peerCountDisplay.textContent = `${count} ${count === 1 ? 'Player' : 'Players'}`;
  updateLeaderboard();
}

function broadcastTag(newItId) {
  if (state.actions.sendTag) {
    state.actions.sendTag({ taggedId: newItId, taggerId: state.myId });
  }
}

function handleTagEvent(taggedId, taggerId) {
  sfx.playTag();

  const amITagged = (taggedId === state.myId);
  const wasIIt = state.localPlayer.isIt;

  if (amITagged) {
    state.localPlayer.isIt = true;
    state.tagCooldown = TAG_COOLDOWN_TIME;
    spawnParticles(state.localPlayer.x, state.localPlayer.y, '#ff007b', 30);
    showToast("YOU'RE IT! Catch someone!");
  } else {
    state.localPlayer.isIt = false;
  }

  // If local player was IT and successfully tagged someone else, gain a point
  if (wasIIt && !amITagged) {
    state.localPlayer.score += 1;
  }

  // Update peers
  for (const [id, peer] of state.peers) {
    peer.isIt = (id === taggedId);
    if (id === taggedId) {
      spawnParticles(peer.x, peer.y, '#ff007b', 30);
    }
  }

  updateTagBanner();
  updateLeaderboard();
}

function updateTagBanner() {
  if (state.localPlayer.isIt) {
    tagStatusBanner.className = 'tag-status-banner';
    tagStatusText.textContent = "YOU'RE IT! Chase!";
  } else {
    tagStatusBanner.className = 'tag-status-banner runner';
    tagStatusText.textContent = "RUN! Avoid the IT player!";
  }
}

function updateLeaderboard() {
  const players = [
    { name: state.localPlayer.name, color: state.localPlayer.color, score: state.localPlayer.score, isIt: state.localPlayer.isIt, isMe: true },
    ...Array.from(state.peers.values()).map(p => ({ name: p.name, color: p.color, score: p.score, isIt: p.isIt, isMe: false }))
  ];

  players.sort((a, b) => b.score - a.score);

  playerList.innerHTML = players.map(p => `
    <div class="player-entry">
      <div class="player-entry-left">
        <span class="player-color-dot" style="background-color: ${p.color}"></span>
        <span>${escapeHtml(p.name)}${p.isMe ? ' (You)' : ''}</span>
      </div>
      <div>
        <span class="player-tag-badge ${p.isIt ? 'it' : 'runner'}">${p.isIt ? 'IT' : 'RUN'}</span>
        <span class="mono" style="margin-left: 6px; font-weight:700;">${p.score}</span>
      </div>
    </div>
  `).join('');
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag] || tag));
}

// --------------------------------------------------
// HIGH FREQUENCY SYNC (THROTTLED NETWORK TICK)
// --------------------------------------------------
let lastNetworkTick = 0;
const tickIntervalMs = 1000 / NETWORK_TICK_RATE; // ~40ms

function networkTick(now) {
  if (now - lastNetworkTick >= tickIntervalMs) {
    lastNetworkTick = now;

    if (state.actions.sendPos) {
      state.actions.sendPos({
        x: Math.round(state.localPlayer.x),
        y: Math.round(state.localPlayer.y),
        name: state.localPlayer.name,
        color: state.localPlayer.color,
        isIt: state.localPlayer.isIt,
        score: state.localPlayer.score
      });
    }
  }
}

// --------------------------------------------------
// PHYSICS & COLLISION
// --------------------------------------------------
function checkObstacleCollision(circleX, circleY, radius) {
  for (const obs of state.obstacles) {
    const closestX = Math.max(obs.x, Math.min(circleX, obs.x + obs.w));
    const closestY = Math.max(obs.y, Math.min(circleY, obs.y + obs.h));
    const distX = circleX - closestX;
    const distY = circleY - closestY;
    const distanceSquared = (distX * distX) + (distY * distY);

    if (distanceSquared < (radius * radius)) {
      return true;
    }
  }
  return false;
}

function updatePhysics(dt) {
  const p = state.localPlayer;

  // Dash timers
  if (p.dashCooldown > 0) p.dashCooldown -= dt;
  if (p.dashTimer > 0) {
    p.dashTimer -= dt;
    if (p.dashTimer <= 0) p.dashing = false;
  }

  // Tag cooldown
  if (state.tagCooldown > 0) {
    state.tagCooldown -= dt;
  }

  // Overhead speech bubble timer
  if (p.bubbleTimer > 0) {
    p.bubbleTimer -= dt;
    if (p.bubbleTimer <= 0) p.bubble = null;
  }

  // Peers bubble timer & entity interpolation (lerp)
  for (const peer of state.peers.values()) {
    if (peer.bubbleTimer > 0) {
      peer.bubbleTimer -= dt;
      if (peer.bubbleTimer <= 0) peer.bubble = null;
    }

    // Smooth client-side lerp for remote players
    peer.x += (peer.targetX - peer.x) * 0.25;
    peer.y += (peer.targetY - peer.y) * 0.25;
  }

  // Calculate local movement direction
  let dx = 0;
  let dy = 0;

  if (state.keys.w) dy -= 1;
  if (state.keys.s) dy += 1;
  if (state.keys.a) dx -= 1;
  if (state.keys.d) dx += 1;

  // Touch joystick override
  if (state.touchVector.x !== 0 || state.touchVector.y !== 0) {
    dx = state.touchVector.x;
    dy = state.touchVector.y;
  }

  // Normalize
  const length = Math.hypot(dx, dy);
  if (length > 0) {
    dx /= length;
    dy /= length;
  }

  // Dash activation
  if (state.keys.space && p.dashCooldown <= 0 && length > 0) {
    p.dashing = true;
    p.dashTimer = DASH_DURATION;
    p.dashCooldown = DASH_COOLDOWN;
    sfx.playDash();
    spawnParticles(p.x, p.y, p.color, 15);
  }

  const currentSpeed = p.dashing ? DASH_SPEED : BASE_SPEED;
  const moveX = dx * currentSpeed * dt;
  const moveY = dy * currentSpeed * dt;

  // Axis-separated movement for smooth obstacle sliding
  const nextX = p.x + moveX;
  if (nextX >= PLAYER_RADIUS && nextX <= ARENA_WIDTH - PLAYER_RADIUS && !checkObstacleCollision(nextX, p.y, PLAYER_RADIUS)) {
    p.x = nextX;
  }

  const nextY = p.y + moveY;
  if (nextY >= PLAYER_RADIUS && nextY <= ARENA_HEIGHT - PLAYER_RADIUS && !checkObstacleCollision(p.x, nextY, PLAYER_RADIUS)) {
    p.y = nextY;
  }

  // Tagging Collision Detection (If Local Player is IT)
  if (p.isIt && state.tagCooldown <= 0) {
    for (const [peerId, peer] of state.peers) {
      const dist = Math.hypot(p.x - peer.x, p.y - peer.y);
      if (dist < PLAYER_RADIUS * 2) {
        // Tagged peer!
        broadcastTag(peerId);
        handleTagEvent(peerId, state.myId);
        break;
      }
    }
  }

  // Update particles
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const pt = state.particles[i];
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
    if (pt.life <= 0) state.particles.splice(i, 1);
  }
}

function spawnParticles(x, y, color, count = 12) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 150 + 50;
    state.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      life: Math.random() * 0.4 + 0.2,
      maxLife: 0.6,
      size: Math.random() * 4 + 2
    });
  }
}

// --------------------------------------------------
// RENDERING PIPELINE (2D CANVAS)
// --------------------------------------------------
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight - 56; // 56px HUD offset
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function drawGrid(camX, camY) {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  const gridSize = 60;

  const startX = Math.floor(camX / gridSize) * gridSize;
  const startY = Math.floor(camY / gridSize) * gridSize;

  ctx.beginPath();
  for (let x = startX; x < startX + canvas.width + gridSize; x += gridSize) {
    ctx.moveTo(x - camX, 0);
    ctx.lineTo(x - camX, canvas.height);
  }
  for (let y = startY; y < startY + canvas.height + gridSize; y += gridSize) {
    ctx.moveTo(0, y - camY);
    ctx.lineTo(canvas.width, y - camY);
  }
  ctx.stroke();
}

function drawArenaBounds(camX, camY) {
  ctx.save();
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 4;
  ctx.shadowColor = '#00f0ff';
  ctx.shadowBlur = 15;
  ctx.strokeRect(-camX, -camY, ARENA_WIDTH, ARENA_HEIGHT);
  ctx.restore();
}

function drawObstacles(camX, camY) {
  ctx.save();
  for (const obs of state.obstacles) {
    const rx = obs.x - camX;
    const ry = obs.y - camY;

    // Obstacle body
    ctx.fillStyle = '#171b2d';
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(rx, ry, obs.w, obs.h, 8);
    ctx.fill();
    ctx.stroke();

    // Subtle neon pattern
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.fillRect(rx + 4, ry + 4, obs.w - 8, obs.h - 8);
  }
  ctx.restore();
}

function drawPlayerEntity(p, camX, camY, isLocal = false) {
  const sx = p.x - camX;
  const sy = p.y - camY;

  ctx.save();

  // If this player is "IT", draw danger aura pulse
  if (p.isIt) {
    const pulse = Math.sin(performance.now() * 0.008) * 6;
    ctx.fillStyle = 'rgba(255, 0, 123, 0.2)';
    ctx.beginPath();
    ctx.arc(sx, sy, PLAYER_RADIUS + 10 + pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ff007b';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#ff007b';
    ctx.shadowBlur = 18;
  } else {
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 10;
  }

  // Player body circle
  ctx.fillStyle = '#10131e';
  ctx.beginPath();
  ctx.arc(sx, sy, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Core jewel
  ctx.fillStyle = p.isIt ? '#ff007b' : p.color;
  ctx.beginPath();
  ctx.arc(sx, sy, PLAYER_RADIUS * 0.5, 0, Math.PI * 2);
  ctx.fill();

  // "IT" Crown icon above head
  if (p.isIt) {
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('👑', sx, sy - PLAYER_RADIUS - 16);
  }

  // Name tag
  ctx.font = '700 11px "Plus Jakarta Sans", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 4;
  ctx.fillText(p.name + (isLocal ? ' (You)' : ''), sx, sy - PLAYER_RADIUS - 4);

  // Overhead Speech Bubble
  if (p.bubble) {
    ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
    const textWidth = ctx.measureText(p.bubble).width;
    const bubbleW = Math.max(textWidth + 18, 36);
    const bubbleH = 26;
    const bubbleX = sx - bubbleW / 2;
    const bubbleY = sy - PLAYER_RADIUS - 46;

    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.roundRect(bubbleX, bubbleY, bubbleW, bubbleH, 12);
    ctx.fill();

    // Bubble pointer
    ctx.beginPath();
    ctx.moveTo(sx - 5, bubbleY + bubbleH);
    ctx.lineTo(sx, bubbleY + bubbleH + 6);
    ctx.lineTo(sx + 5, bubbleY + bubbleH);
    ctx.fill();

    // Bubble text
    ctx.fillStyle = '#0a0b10';
    ctx.textAlign = 'center';
    ctx.fillText(p.bubble, sx, bubbleY + 17);
  }

  ctx.restore();
}

function drawParticles(camX, camY) {
  ctx.save();
  for (const pt of state.particles) {
    const alpha = Math.max(0, pt.life / pt.maxLife);
    ctx.fillStyle = pt.color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(pt.x - camX, pt.y - camY, pt.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// --------------------------------------------------
// MAIN GAME LOOP
// --------------------------------------------------
let lastTime = performance.now();

function gameLoop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.1); // clamp to avoid spiral of death
  lastTime = now;

  // 1. Update Game Physics & Network
  updatePhysics(dt);
  networkTick(now);

  // 2. Camera tracking (smooth local player following)
  const camX = state.localPlayer.x - canvas.width / 2;
  const camY = state.localPlayer.y - canvas.height / 2;

  // 3. Render Canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid(camX, camY);
  drawArenaBounds(camX, camY);
  drawObstacles(camX, camY);

  // Draw remote peers
  for (const peer of state.peers.values()) {
    drawPlayerEntity(peer, camX, camY, false);
  }

  // Draw local player
  drawPlayerEntity(state.localPlayer, camX, camY, true);

  // Draw particles
  drawParticles(camX, camY);

  requestAnimationFrame(gameLoop);
}

// --------------------------------------------------
// USER INPUTS & EVENT HANDLERS
// --------------------------------------------------
window.addEventListener('keydown', e => {
  sfx.init();
  if (document.activeElement === chatInput) {
    if (e.key === 'Enter') {
      submitChat();
    }
    return;
  }

  const k = e.key.toLowerCase();
  if (k === 'w' || e.key === 'ArrowUp') state.keys.w = true;
  if (k === 's' || e.key === 'ArrowDown') state.keys.s = true;
  if (k === 'a' || e.key === 'ArrowLeft') state.keys.a = true;
  if (k === 'd' || e.key === 'ArrowRight') state.keys.d = true;
  if (e.code === 'Space') {
    state.keys.space = true;
    e.preventDefault();
  }

  if (k === 'enter') {
    chatInput.focus();
    e.preventDefault();
  }
});

window.addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  if (k === 'w' || e.key === 'ArrowUp') state.keys.w = false;
  if (k === 's' || e.key === 'ArrowDown') state.keys.s = false;
  if (k === 'a' || e.key === 'ArrowLeft') state.keys.a = false;
  if (k === 'd' || e.key === 'ArrowRight') state.keys.d = false;
  if (e.code === 'Space') state.keys.space = false;
});

function submitChat(emojiText) {
  sfx.init();
  const text = (emojiText || chatInput.value).trim();
  if (!text) return;

  state.localPlayer.bubble = text;
  state.localPlayer.bubbleTimer = 3.5;
  sfx.playPop();

  if (state.actions.sendChat) {
    state.actions.sendChat({ text });
  }

  if (!emojiText) {
    chatInput.value = '';
    chatInput.blur();
  }
}

// Emoji quick reaction buttons
document.querySelectorAll('.emoji-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    submitChat(btn.dataset.emoji);
  });
});

// Copy Room Link
copyRoomBtn.addEventListener('click', () => {
  sfx.init();
  const inviteUrl = `${window.location.origin}${window.location.pathname}#${state.roomId}`;
  navigator.clipboard.writeText(inviteUrl).then(() => {
    showToast('Room link copied to clipboard!');
  }).catch(() => {
    showToast(`Room: #${state.roomId}`);
  });
});

// Switch Room Modal
changeRoomBtn.addEventListener('click', () => {
  sfx.init();
  roomInput.value = state.roomId;
  nameInput.value = state.localPlayer.name;
  roomModal.showModal();
});

cancelModalBtn.addEventListener('click', () => {
  roomModal.close();
});

joinModalBtn.addEventListener('click', () => {
  sfx.init();
  const newRoom = roomInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'lobby';
  const newName = nameInput.value.trim() || 'Player';

  localStorage.setItem('neon_tag_name', newName);
  state.localPlayer.name = newName;

  roomModal.close();
  window.location.hash = newRoom;
  window.location.reload();
});

// Mobile Virtual Joystick Handlers
const joystickBase = document.getElementById('joystickBase');
const joystickThumb = document.getElementById('joystickThumb');
const touchDashBtn = document.getElementById('touchDashBtn');

let touchId = null;
let baseRect = null;

if (joystickBase) {
  joystickBase.addEventListener('touchstart', e => {
    sfx.init();
    const touch = e.changedTouches[0];
    touchId = touch.identifier;
    baseRect = joystickBase.getBoundingClientRect();
    handleJoystickMove(touch.clientX, touch.clientY);
  }, { passive: false });

  window.addEventListener('touchmove', e => {
    if (touchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchId) {
        handleJoystickMove(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
        break;
      }
    }
  }, { passive: false });

  const resetJoystick = e => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchId) {
        touchId = null;
        state.touchVector.x = 0;
        state.touchVector.y = 0;
        joystickThumb.style.transform = `translate(0px, 0px)`;
        break;
      }
    }
  };

  window.addEventListener('touchend', resetJoystick);
  window.addEventListener('touchcancel', resetJoystick);
}

function handleJoystickMove(clientX, clientY) {
  if (!baseRect) return;
  const centerX = baseRect.left + baseRect.width / 2;
  const centerY = baseRect.top + baseRect.height / 2;
  const maxRadius = baseRect.width / 2;

  let dx = clientX - centerX;
  let dy = clientY - centerY;
  const dist = Math.hypot(dx, dy);

  if (dist > maxRadius) {
    dx = (dx / dist) * maxRadius;
    dy = (dy / dist) * maxRadius;
  }

  joystickThumb.style.transform = `translate(${dx}px, ${dy}px)`;
  state.touchVector.x = dx / maxRadius;
  state.touchVector.y = dy / maxRadius;
}

if (touchDashBtn) {
  touchDashBtn.addEventListener('touchstart', e => {
    e.preventDefault();
    sfx.init();
    state.keys.space = true;
    setTimeout(() => { state.keys.space = false; }, 100);
  });
}

// --------------------------------------------------
// START APPLICATION
// --------------------------------------------------
if (window.lucide) {
  window.lucide.createIcons();
}
initMultiplayer();
requestAnimationFrame(gameLoop);
