/* =====================================================================
   PUNCH UNTIL DEATH — "Bridge of Steel", Stage 1
   An original 8-bit-arcade-style beat-em-up.
   Hero: KAI (green cyber-ninja).  Enemies: robot drones.  Boss: TITAN-X.
   Pure canvas, no assets — everything is drawn procedurally.
   ===================================================================== */
"use strict";

/* ----------------------------- Constants ----------------------------- */
const CANVAS_W = 512;
const CANVAS_H = 320;
const HUD_Y = 240;            // HUD occupies y = 240..320
const PLAY_H = HUD_Y;         // playable height
const FLOOR_TOP = 162;        // nearest the back wall (feet y, small = far)
const FLOOR_BOTTOM = 232;     // nearest the camera (feet y, large = near)
const WALL_PAD = 26;          // how close to screen edge actors may stand
const WALK_X = 150;           // player horizontal speed (px/s)
const WALK_Z = 102;           // player depth speed (px/s)
const DECAY = 8;              // knockback / roll velocity decay rate
const JUMP_V = 350;           // initial jump velocity (px/s upward)
const GRAV = 1150;            // gravity (px/s^2) acting on altitude

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;
ctx.textBaseline = "alphabetic";

/* ----------------------------- Utilities ----------------------------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;
const px = Math.round;
const sign = (n) => (n < 0 ? -1 : 1);

/* ------------------------------- Input -------------------------------
   Devices (keyboard schemes + gamepads) feed per-player input sources.
   Logical actions are resolved each frame; justPressed = down-now & !down-last. */
const ACTIONS = ["left", "right", "up", "down", "punch", "kick", "special", "jump", "block", "start", "back"];

const KB = {
  down: new Set(),
  init() {
    const block = new Set([
      "ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Space",
      "KeyW","KeyA","KeyS","KeyD","KeyJ","KeyK","KeyL","KeyP","KeyM","Enter",
      "ShiftLeft","ShiftRight","KeyF","KeyG","KeyR","KeyV","KeyQ",
      "Period","Comma","Slash","ControlRight","Backspace","Escape",
    ]);
    addEventListener("keydown", (e) => { if (block.has(e.code)) e.preventDefault(); KB.down.add(e.code); Sound.unlock(); });
    addEventListener("keyup", (e) => KB.down.delete(e.code));
    addEventListener("blur", () => KB.down.clear());
    addEventListener("pointerdown", () => Sound.unlock());
    addEventListener("gamepadconnected", () => { Sound.unlock(); if (game.onDevicesChanged) game.onDevicesChanged(); });
    addEventListener("gamepaddisconnected", () => { if (game.onDevicesChanged) game.onDevicesChanged(); });
  },
  has(codes) { for (const c of codes) if (this.down.has(c)) return true; return false; },
};

const Pads = {
  state: {},
  poll() {
    this.state = {};
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < gps.length; i++) {
      const g = gps[i];
      if (!g || !g.connected) continue;
      this.state[i] = { buttons: g.buttons.map((b) => b.pressed || b.value > 0.4), axes: g.axes.slice() };
    }
  },
  connected() { return Object.keys(this.state).map(Number); },
  button(i, b) { const s = this.state[i]; return !!(s && s.buttons[b]); },
  axis(i, a) { const s = this.state[i]; return s ? (s.axes[a] || 0) : 0; },
  anyButton(i) { const s = this.state[i]; return !!(s && s.buttons.some((b) => b)); },
};

function padAction(idx, a) {
  switch (a) {
    case "left":  return Pads.button(idx, 14) || Pads.axis(idx, 0) < -0.45;
    case "right": return Pads.button(idx, 15) || Pads.axis(idx, 0) >  0.45;
    case "up":    return Pads.button(idx, 12) || Pads.axis(idx, 1) < -0.45;
    case "down":  return Pads.button(idx, 13) || Pads.axis(idx, 1) >  0.45;
    case "jump":    return Pads.button(idx, 0);                 // A
    case "kick":    return Pads.button(idx, 1);                 // B
    case "punch":   return Pads.button(idx, 2);                 // X
    case "special": return Pads.button(idx, 3);                 // Y
    case "block":   return Pads.button(idx, 4) || Pads.button(idx, 5) || Pads.button(idx, 6) || Pads.button(idx, 7);
    case "start":   return Pads.button(idx, 9);
    case "back":    return Pads.button(idx, 8);
  }
  return false;
}

// keyboard schemes (action -> [codes])
const KB_SOLO = { type: "kb", name: "KEYBOARD", short: "WASD/Arrows · J K L · Space · Shift", map: {
  left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"], up: ["ArrowUp", "KeyW"], down: ["ArrowDown", "KeyS"],
  punch: ["KeyJ"], kick: ["KeyK"], special: ["KeyL"], jump: ["Space"], block: ["ShiftLeft", "ShiftRight"],
  start: ["Enter"], back: ["Escape", "Backspace"] } };
const KB_LEFT = { type: "kb", name: "KEYBOARD (left)", short: "WASD · F G R · V · Q", map: {
  left: ["KeyA"], right: ["KeyD"], up: ["KeyW"], down: ["KeyS"],
  punch: ["KeyF"], kick: ["KeyG"], special: ["KeyR"], jump: ["KeyV"], block: ["KeyQ"],
  start: ["Enter"], back: ["Escape"] } };
const KB_RIGHT = { type: "kb", name: "KEYBOARD (right)", short: "Arrows · . , / · RShift · RCtrl", map: {
  left: ["ArrowLeft"], right: ["ArrowRight"], up: ["ArrowUp"], down: ["ArrowDown"],
  punch: ["Period"], kick: ["Comma"], special: ["Slash"], jump: ["ShiftRight"], block: ["ControlRight"],
  start: ["Enter"], back: ["Escape"] } };

class PlayerInput {
  constructor() { this.dev = KB_SOLO; this.cur = {}; this.prev = {}; }
  setDevice(d) { this.dev = d; }
  label() { return this.dev.type === "pad" ? "GAMEPAD " + (this.dev.index + 1) : this.dev.name; }
  poll() {
    this.prev = this.cur; this.cur = {};
    const d = this.dev;
    for (const a of ACTIONS) this.cur[a] = d.type === "kb" ? KB.has(d.map[a] || []) : padAction(d.index, a);
  }
  isDown(a) { return !!this.cur[a]; }
  justPressed(a) { return !!this.cur[a] && !this.prev[a]; }
  anyJustPressed() { for (const a of ACTIONS) if (this.cur[a] && !this.prev[a]) return true; return false; }
}

// two persistent input sources (slots + in-game players share these)
const inputs = [new PlayerInput(), new PlayerInput()];

// global menu input: aggregate of keyboard + any pad, with edge detection
const Menu = {
  cur: {}, prev: {},
  poll() {
    this.prev = this.cur; this.cur = {};
    const pads = Pads.connected();
    const anyPad = (a) => pads.some((i) => padAction(i, a));
    this.cur.start = KB.has(["Enter", "Space"]) || anyPad("start") || anyPad("jump") || anyPad("punch");
    this.cur.back = KB.has(["Escape", "Backspace"]) || anyPad("back");
    this.cur.left = KB.has(["ArrowLeft", "KeyA"]) || anyPad("left");
    this.cur.right = KB.has(["ArrowRight", "KeyD"]) || anyPad("right");
    this.cur.pause = KB.has(["KeyP"]) || anyPad("start");   // P or pad Start button toggles pause in-game
    this.cur.mute = KB.has(["KeyM"]);
  },
  jp(a) { return !!this.cur[a] && !this.prev[a]; },
};

/* ----------------------------- Mini synth ---------------------------- */
const Sound = {
  ctx: null, master: null, muted: false,
  unlock() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.16;
      this.master.connect(this.ctx.destination);
    } catch (e) { /* no audio */ }
  },
  tone(freq, dur, type = "square", vol = 0.5, slideTo = null) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol = 0.5, hp = 400) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  },
  punch()   { this.tone(220, 0.07, "square", 0.4, 140); },
  whiff()   { this.tone(180, 0.06, "triangle", 0.18, 120); },
  hit()     { this.noise(0.08, 0.5, 600); this.tone(160, 0.06, "square", 0.3, 90); },
  kick()    { this.tone(120, 0.10, "square", 0.45, 70); this.noise(0.06, 0.3, 500); },
  block()   { this.tone(500, 0.05, "square", 0.3, 700); this.noise(0.04, 0.25, 1500); },
  special() { this.tone(300, 0.05, "sawtooth", 0.4, 900); this.tone(600, 0.25, "sawtooth", 0.35, 120); this.noise(0.25, 0.35, 300); },
  roll()    { this.tone(420, 0.10, "triangle", 0.25, 220); },
  jump()    { this.tone(300, 0.16, "square", 0.3, 620); },
  land()    { this.noise(0.05, 0.2, 500); this.tone(160, 0.05, "square", 0.2, 90); },
  pizza()   { [523, 659, 880].forEach((f, i) => setTimeout(() => this.tone(f, 0.12, "square", 0.4), i * 70)); },
  laser()   { this.tone(900, 0.18, "sawtooth", 0.35, 180); this.noise(0.06, 0.2, 1200); },
  stomp()   { this.tone(90, 0.16, "square", 0.5, 50); this.noise(0.12, 0.4, 200); },
  hurt()    { this.tone(300, 0.12, "sawtooth", 0.4, 90); },
  die()     { this.tone(400, 0.30, "square", 0.4, 60); this.noise(0.3, 0.3, 200); },
  step()    { this.noise(0.03, 0.08, 800); },
  pick()    { this.tone(660, 0.06, "square", 0.4); },
  start()   { this.tone(523, 0.09, "square", 0.4); setTimeout(()=>this.tone(784,0.16,"square",0.4),90); },
  go()      { this.tone(880, 0.08, "square", 0.4); setTimeout(()=>this.tone(1175,0.12,"square",0.4),80); },
  warn()    { this.tone(110, 0.2, "sawtooth", 0.45); },
  gameover(){ [392,330,262,196].forEach((f,i)=>setTimeout(()=>this.tone(f,0.3,"square",0.4),i*220)); },
  win()     { [523,659,784,1047].forEach((f,i)=>setTimeout(()=>this.tone(f,0.22,"square",0.4),i*150)); },
};

/* --------------------------- Enemy kinds ----------------------------- */
/* Each grunt has a `pal` (Stage 1 look) and `sewerPal` (Stage 2 recolor). */
const KINDS = {
  drone: {
    hp: 30, speed: 70, dmg: 8, scale: 1, score: 200, knockTaken: 1, behavior: "melee", vReach: 30,
    windup: 0.42, active: 0.12, recover: 0.42, range: 34, depth: 28, atkKnock: 150,
    pal: { metal: "#b9c2cf", mHi: "#d8dee8", mSh: "#7c8698", dark: "#4b5363",
           eye: "#ff4533", trim: "#8a93a4", trimHi: "#aab2bf", trimSh: "#5c6573" },
    sewerPal: { metal: "#7e8a6c", mHi: "#9fae88", mSh: "#515c42", dark: "#2c3324",
           eye: "#9bff4d", trim: "#6f7d58", trimHi: "#8b9a6e", trimSh: "#454f34" },
  },
  red: {
    hp: 24, speed: 116, dmg: 11, scale: 1, score: 320, knockTaken: 1.1, behavior: "melee", vReach: 30,
    windup: 0.30, active: 0.10, recover: 0.34, range: 38, depth: 30, atkKnock: 190,
    pal: { metal: "#d6493a", mHi: "#f1745f", mSh: "#9a3024", dark: "#4f1a15",
           eye: "#ffe23a", trim: "#ff8a3a", trimHi: "#ffb06a", trimSh: "#c25f1f" },
    sewerPal: { metal: "#9a6b3a", mHi: "#c08d55", mSh: "#5f3f1f", dark: "#33220f",
           eye: "#caff3a", trim: "#c0792e", trimHi: "#e0a05a", trimSh: "#7a4a1c" },
  },
  // Ranged gunner — keeps its distance and fires laser bolts
  laser: {
    hp: 22, speed: 60, dmg: 0, scale: 1, score: 360, knockTaken: 1, behavior: "gunner", vReach: 30,
    aim: 0.55, recover: 0.5, preferDist: 178, projSpeed: 300, projDmg: 10,
    fireMin: 1.3, fireMax: 2.4,
    pal: { metal: "#46a886", mHi: "#69d2ad", mSh: "#2c6f59", dark: "#1d3d33",
           eye: "#ff4d4d", trim: "#ffd23a", trimHi: "#ffe884", trimSh: "#c79a1f" },
    sewerPal: { metal: "#4a7a52", mHi: "#6fa873", mSh: "#2c4f33", dark: "#16291b",
           eye: "#caff3a", trim: "#9bff5a", trimHi: "#c3ff9a", trimSh: "#5f9a2f" },
  },
  // Brute — big, slow, hits hard and is tough to stagger
  brute: {
    hp: 76, speed: 40, dmg: 18, scale: 1.34, score: 520, knockTaken: 0.4, behavior: "melee", vReach: 42,
    windup: 0.74, active: 0.16, recover: 0.72, range: 44, depth: 32, atkKnock: 300,
    pal: { metal: "#8b8f99", mHi: "#aeb3bd", mSh: "#5b5f69", dark: "#33363d",
           eye: "#ff8a1e", trim: "#e07b2e", trimHi: "#ffa451", trimSh: "#a3531b" },
    sewerPal: { metal: "#6f6f56", mHi: "#909073", mSh: "#454538", dark: "#26261a",
           eye: "#9bff4d", trim: "#7a6b3a", trimHi: "#a3905a", trimSh: "#4f441f" },
  },
  // Flyer — hovers above the ground and swoops down to attack
  flyer: {
    hp: 18, speed: 122, dmg: 10, scale: 1, score: 300, knockTaken: 1.25, behavior: "flyer", vReach: 26,
    windup: 0.3, active: 0.5, recover: 0.55, range: 30, depth: 26, atkKnock: 180,
    hoverMin: 30, hoverMax: 46,
    pal: { metal: "#8a6fc0", mHi: "#ad93dd", mSh: "#5b478a", dark: "#2e2447",
           eye: "#7cffea", trim: "#ff5ad6", trimHi: "#ff9ce6", trimSh: "#b53a96" },
    sewerPal: { metal: "#5a7a6a", mHi: "#7fa890", mSh: "#384f44", dark: "#1f2e28",
           eye: "#caff3a", trim: "#7bdf8a", trimHi: "#a8f0b2", trimSh: "#3f8a4f" },
  },
  // Stage 1 boss
  boss: {
    name: "TITAN-X",
    hp: 360, speed: 46, dmg: 16, scale: 1.6, score: 6000, knockTaken: 0.18, behavior: "boss", vReach: 70,
    windup: 0.5, active: 0.14, recover: 0.6, range: 58, depth: 40, atkKnock: 300,
    isBoss: true,
    pal: { metal: "#6c7686", mHi: "#8d96a6", mSh: "#474f5b", dark: "#2c333f",
           eye: "#ffd000", trim: "#c0392b", trimHi: "#e0584a", trimSh: "#7e251b" },
  },
  // Stage 2 boss — toxic sewer hulk
  ooze: {
    name: "SLUDGE-9",
    hp: 440, speed: 44, dmg: 18, scale: 1.7, score: 8000, knockTaken: 0.16, behavior: "boss", vReach: 72,
    windup: 0.5, active: 0.15, recover: 0.58, range: 60, depth: 42, atkKnock: 320,
    isBoss: true,
    pal: { metal: "#5a6a4a", mHi: "#7d8e64", mSh: "#374227", dark: "#1d2416",
           eye: "#9bff3a", trim: "#3a7a2a", trimHi: "#62b83a", trimSh: "#235018" },
  },
};

const MAX_CONCURRENT = 4;

/* --------------------------- Playable roster ------------------------- */
/* All play identically (same moveset/stats) — they differ only in look. */
const CHARACTERS = [
  { name: "KAI",   pal: { sk: "#69c23f", skH: "#8eda57", skS: "#3f8a2c", bd: "#2f7bf6", bdH: "#66a6ff", bdS: "#1a4cb0",
    bl: "#e6b53f", blH: "#f6cf63", blS: "#a87d22", pd: "#caa24a", pdS: "#9a7a2f", bt: "#27508a", btH: "#3f74c0", btS: "#163559", o: "#16240e", eye: "#fff", pp: "#16263f" } },
  { name: "BLAZE", pal: { sk: "#5fb83a", skH: "#86d75a", skS: "#3a7e29", bd: "#e23a2f", bdH: "#ff6f5f", bdS: "#a01f17",
    bl: "#ffb13a", blH: "#ffd07a", blS: "#bf7a1f", pd: "#d98a3a", pdS: "#a35f22", bt: "#7a2a22", btH: "#b04539", btS: "#4f150f", o: "#1a2410", eye: "#fff", pp: "#2a1410" } },
  { name: "VOLT",  pal: { sk: "#6cc24a", skH: "#92dd66", skS: "#418c2f", bd: "#ffd21f", bdH: "#ffe87a", bdS: "#c79a12", bl: "#3ac0d9", blH: "#7ce0f0", blS: "#1f8aa3", pd: "#c9b34a", pdS: "#998230", bt: "#2a6b7a", btH: "#3f9bb0", btS: "#153d47", o: "#16240e", eye: "#fff", pp: "#16263f" } },
  { name: "ONYX",  pal: { sk: "#8a8f9c", skH: "#aab0bd", skS: "#5b6070", bd: "#9b59d0", bdH: "#c089ee", bdS: "#6a37a0", bl: "#c0c4cf", blH: "#e0e3ea", blS: "#878c98", pd: "#7a7f8c", pdS: "#52555f", bt: "#3a2f55", btH: "#574a7a", btS: "#221b36", o: "#15131c", eye: "#fff", pp: "#15131c" } },
];
const P_TAGCOLOR = ["#ffffff", "#ffe23a"];   // P1 / P2 number tag colours

/* --------------------------- Road obstacles -------------------------- */
/* Solid props on the road. halfW/halfD = ground footprint; h = how high you
   must jump to clear them. Actors push out of them and can walk around. */
const OBSTACLE_TYPES = {
  cone:    { halfW: 6,  halfD: 6,  h: 18 },
  drum:    { halfW: 9,  halfD: 8,  h: 34 },
  crate:   { halfW: 12, halfD: 10, h: 30 },
  barrier: { halfW: 19, halfD: 7,  h: 26 },
};
// z kept in a middle band so there's always a walkable lane on each side
const OBSTACLES_BRIDGE = [
  { x: 500,  z: 190, type: "cone" },
  { x: 545,  z: 204, type: "cone" },
  { x: 970,  z: 198, type: "drum" },
  { x: 1450, z: 192, type: "barrier" },
  { x: 1620, z: 202, type: "crate" },
  { x: 1980, z: 196, type: "drum" },
  { x: 2450, z: 194, type: "barrier" },
  { x: 2560, z: 200, type: "drum" },
  { x: 2980, z: 202, type: "crate" },
  { x: 3060, z: 190, type: "cone" },
  { x: 3450, z: 196, type: "drum" },
  { x: 3560, z: 198, type: "barrier" },
  { x: 3980, z: 200, type: "crate" },
  { x: 4420, z: 192, type: "drum" },
  { x: 4470, z: 204, type: "cone" },
  { x: 4720, z: 196, type: "barrier" },
];
// sewers: barrels, crates and rubble (no traffic cones down here)
const OBSTACLES_SEWER = [
  { x: 520,  z: 196, type: "drum" },
  { x: 1010, z: 200, type: "crate" },
  { x: 1080, z: 190, type: "drum" },
  { x: 1520, z: 196, type: "barrier" },
  { x: 1980, z: 202, type: "drum" },
  { x: 2040, z: 192, type: "crate" },
  { x: 2520, z: 196, type: "barrier" },
  { x: 2980, z: 200, type: "drum" },
  { x: 3060, z: 192, type: "crate" },
  { x: 3520, z: 196, type: "barrier" },
  { x: 3980, z: 200, type: "drum" },
  { x: 4040, z: 190, type: "crate" },
];

/* ------------------------------ Stages ------------------------------- */
/* Each stage: world length, theme, obstacle list, and a room list. The boss
   room's lockCam is auto-set to (length - CANVAS_W). */
function makeStage(s) {
  s.camMax = s.length - CANVAS_W;
  s.rooms[s.rooms.length - 1].lockCam = s.camMax;   // boss room locks at the end
  return s;
}
const STAGES = [
  makeStage({
    name: "BRIDGE OF STEEL", theme: "bridge", length: 5400, obstacles: OBSTACLES_BRIDGE,
    rooms: [
      { lockCam: 300,  spawns: ["drone", "drone", "drone"] },
      { lockCam: 760,  spawns: ["drone", "drone", "red", "drone"] },
      { lockCam: 1220, spawns: ["drone", "drone", "brute", "drone"] },
      { lockCam: 1680, spawns: ["drone", "laser", "drone", "laser", "red"] },
      { lockCam: 2160, spawns: ["flyer", "drone", "flyer", "drone", "red"], pizza: true },
      { lockCam: 2640, spawns: ["brute", "red", "brute", "drone", "red"] },
      { lockCam: 3120, spawns: ["laser", "flyer", "drone", "laser", "red", "red"] },
      { lockCam: 3600, spawns: ["flyer", "brute", "laser", "red", "drone", "flyer"], pizza: true },
      { lockCam: 4140, spawns: ["red", "red", "drone", "brute", "red", "flyer", "drone"] },
      { spawns: ["boss"], boss: true },
    ],
  }),
  makeStage({
    name: "TOXIC SEWERS", theme: "sewer", length: 5000, obstacles: OBSTACLES_SEWER,
    rooms: [
      { lockCam: 300,  spawns: ["drone", "drone", "drone"] },
      { lockCam: 760,  spawns: ["drone", "red", "drone", "red"] },
      { lockCam: 1240, spawns: ["laser", "drone", "laser", "drone"] },
      { lockCam: 1720, spawns: ["brute", "drone", "red", "drone"], pizza: true },
      { lockCam: 2200, spawns: ["flyer", "drone", "flyer", "red"] },
      { lockCam: 2680, spawns: ["laser", "brute", "flyer", "red", "drone"] },
      { lockCam: 3160, spawns: ["red", "red", "laser", "drone", "flyer"] },
      { lockCam: 3640, spawns: ["brute", "brute", "red", "flyer", "drone"], pizza: true },
      { lockCam: 4120, spawns: ["red", "flyer", "laser", "brute", "drone", "red", "flyer"] },
      { spawns: ["ooze"], boss: true },
    ],
  }),
];

// push an actor out of any solid obstacle (skipped while jumping above its height)
function collideObstacles(actor, rx, rz) {
  for (const o of game.obstacles) {
    if (actor.alt >= o.h) continue;                 // cleared by a jump
    const dx = actor.worldX - o.x, dz = actor.z - o.z;
    const ox = o.halfW + rx, oz = o.halfD + rz;
    if (Math.abs(dx) < ox && Math.abs(dz) < oz) {
      const penX = ox - Math.abs(dx), penZ = oz - Math.abs(dz);
      if (penX <= penZ) {
        actor.worldX += dx < 0 ? -penX : penX;
      } else {
        // pop around toward the lane with room (don't shove into the road edge)
        const roomUp = (o.z - oz) - FLOOR_TOP;
        const roomDown = FLOOR_BOTTOM - (o.z + oz);
        let dir = dz < 0 ? -1 : 1;
        if (dir > 0 && roomDown < penZ) dir = -1;
        else if (dir < 0 && roomUp < penZ) dir = 1;
        actor.z += dir * penZ;
      }
    }
  }
}

/* ============================== Actor =============================== */
class Actor {
  constructor(kind) {
    this.kind = kind;
    this.worldX = 0;
    this.z = FLOOR_BOTTOM;
    this.facing = 1;
    this.vx = 0; this.vz = 0;
    this.moveVX = 0; this.moveVZ = 0;
    this.alt = 0; this.valt = 0;     // altitude (height above ground) + vertical velocity
    this.state = "idle";
    this.stateTime = 0;
    this.animClock = 0;
    this.hitFlash = 0;
    this.dead = false;
    this.hitSet = new Set();   // who current attack already struck
  }
  setState(s) { if (this.state !== s) { this.state = s; this.stateTime = 0; this.hitSet.clear(); } }
  get screenX() { return this.worldX - game.cameraX; }
}

/* ============================== Player ============================== */
class Player extends Actor {
  constructor(charIndex, playerIndex, input) {
    super("hero");
    this.charIndex = charIndex;
    this.playerIndex = playerIndex;
    this.input = input;
    this.char = CHARACTERS[charIndex];
    this.pal = this.char.pal;
    this.name = this.char.name;
    this.maxHp = 100; this.hp = 100;
    this.lives = 3;
    this.special = 0; this.maxSpecial = 100;
    this.invuln = 0;
    this.combo = 0; this.comboTimer = 0;
    this.score = 0;
    this.comboStep = 0;
    this.respawnTimer = 0;
    this.out = false;        // true once lives exhausted (spectating)
    this.tapTimes = { left: -9, right: -9, up: -9, down: -9 };  // for double-tap dash/roll
  }

  arenaBounds() {
    const left = game.cameraX + WALL_PAD;
    const right = game.cameraX + CANVAS_W - WALL_PAD;
    return [left, right];
  }

  takeDamage(dmg, fromX, knock) {
    if (this.invuln > 0 || this.state === "roll" || this.dead) return;
    const blocking = this.state === "block" && sign(fromX - this.worldX) === this.facing;
    if (blocking) {
      this.hp -= dmg * 0.18;
      this.vx = sign(this.worldX - fromX) * 70;
      this.special = clamp(this.special + 4, 0, this.maxSpecial);
      Sound.block();
      spawnText(this.worldX, this.z - 64, "BLOCK", "#7fd3ff");
      sparks(this.worldX + this.facing * 14, this.z - 34, "#bfe3ff", 5);
      shake(2, 0.08);
    } else {
      this.hp -= dmg;
      this.vx = sign(this.worldX - fromX) * knock;
      this.invuln = 0.7;
      this.setState("hurt");
      this.hitFlash = 0.18;
      this.combo = 0;
      Sound.hurt();
      spawnText(this.worldX, this.z - 64, "-" + Math.round(dmg), "#ff5a5a");
      sparks(this.worldX, this.z - 34, "#ff7b7b", 8);
      shake(5, 0.18);
    }
    if (this.hp <= 0) { this.hp = 0; this.die(); }
  }

  die() {
    this.dead = true;
    this.setState("dead");
    this.vx = -this.facing * 120;
    Sound.die();
    shake(7, 0.3);
  }

  gainHit(amount) {
    this.special = clamp(this.special + amount, 0, this.maxSpecial);
    this.combo++;
    this.comboTimer = 1.4;
  }

  update(dt) {
    this.stateTime += dt;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    if (this.out) return;     // exhausted lives — spectating

    // Death / respawn handling
    if (this.dead) {
      this.moveVX = 0; this.moveVZ = 0;
      this.applyPhysics(dt);
      this.respawnTimer += dt;
      if (this.respawnTimer > 1.6) {
        this.lives--;
        if (this.lives < 0) { this.out = true; return; }   // game checks if ALL players are out
        this.dead = false; this.respawnTimer = 0;
        this.hp = this.maxHp; this.invuln = 1.5; this.alt = 0; this.valt = 0;
        this.setState("idle");
        const [l, r] = this.arenaBounds();
        this.worldX = clamp(this.worldX, l, r);
        this.vx = 0; this.vz = 0;
      }
      return;
    }

    const I = this.input;
    const grounded = this.alt <= 0.001;
    const blocking = grounded && I.isDown("block");
    const isGroundBusy = () => ["punch", "kick", "special", "roll", "hurt"].includes(this.state);
    const isAirAttacking = () => this.state === "airpunch" || this.state === "airkick";
    let groundBusy = isGroundBusy();

    // --- start actions ---
    if (grounded && !groundBusy) {
      this.detectDash();
      if (I.justPressed("jump")) { this.startJump(); }
      else if (I.justPressed("special")) { this.startSpecial(); }
      else if (I.justPressed("punch")) { this.startPunch(); }
      else if (I.justPressed("kick")) { this.startKick(); }
      else if (blocking) { this.setState("block"); }
      else if (this.state === "block") { this.setState("idle"); }
    } else if (!grounded && this.state === "jump") {
      if (I.justPressed("kick")) { this.startAirKick(); }
      else if (I.justPressed("punch")) { this.startAirPunch(); }
    }
    groundBusy = isGroundBusy();
    const airAttacking = isAirAttacking();

    // --- movement (direct velocity, frame-independent) ---
    let moveX = 0, moveZ = 0;
    this.moveVX = 0; this.moveVZ = 0;
    const groundLocked = ["special", "roll", "hurt"].includes(this.state);
    const groundMove = grounded && !groundLocked && this.state !== "block" && this.state !== "jump";
    const canSetWalkState = groundMove && !groundBusy;
    const airMove = !grounded;
    if (groundMove || airMove) {
      if (I.isDown("left")) moveX -= 1;
      if (I.isDown("right")) moveX += 1;
      if (I.isDown("up")) moveZ -= 1;
      if (I.isDown("down")) moveZ += 1;
      if (moveX !== 0 && !airAttacking) this.facing = sign(moveX);  // dive-kick keeps its facing
      if (canSetWalkState) {
        if (moveX !== 0 || moveZ !== 0) {
          this.setState("walk");
          this._stepClock = (this._stepClock || 0) + dt;
          if (this._stepClock > 0.30) { this._stepClock = 0; Sound.step(); }
        } else if (this.state === "walk") this.setState("idle");
      }
      const len = Math.hypot(moveX, moveZ) || 1;     // normalize so diagonals aren't faster
      const mul = airMove ? 0.72 : 1;
      this.moveVX = (moveX / len) * WALK_X * mul;
      this.moveVZ = (moveZ / len) * WALK_Z * (airMove ? 0.4 : 1);
    }

    this.updateAttackHits();
    this.resolveTimedStates();
    this.applyPhysics(dt);
    if (moveX !== 0 || moveZ !== 0 || !grounded) this.animClock += dt;
  }

  detectDash() {
    const now = game.time;
    const dirs = [["left", -1, 0], ["right", 1, 0], ["up", 0, -1], ["down", 0, 1]];
    for (const [name, dx, dz] of dirs) {
      if (this.input.justPressed(name)) {
        if (now - this.tapTimes[name] < 0.28) { this.startRoll(dx, dz); this.tapTimes[name] = -9; return; }
        this.tapTimes[name] = now;
      }
    }
  }

  startJump() {
    this.valt = JUMP_V;
    this.setState("jump");
    Sound.jump();
  }
  startAirPunch() { this.setState("airpunch"); this.vx += this.facing * 90; Sound.whiff(); }
  startAirKick() {
    this.setState("airkick");
    this.vx += this.facing * 150;          // dive forward
    if (this.valt > -40) this.valt = -40;  // and downward
    Sound.whiff();
  }
  onLand() {
    if (["jump", "airpunch", "airkick"].includes(this.state)) this.setState("idle");
    Sound.land();
    sparks(this.worldX, this.z, "#cfd6e4", 4);
  }

  startPunch() {
    // 3-hit chain if pressed in rhythm
    this.comboStep = (this.comboStep + 1) % 3;
    this.setState("punch");
    Sound.whiff();
  }
  startKick() { this.comboStep = 0; this.setState("kick"); Sound.whiff(); }
  startRoll(dx = 0, dz = 0) {
    this.setState("roll");
    if (dx === 0 && dz === 0) dx = this.facing;
    if (dx !== 0) this.facing = sign(dx);
    const len = Math.hypot(dx, dz) || 1;
    this.vx = (dx / len) * 430;
    this.vz = (dz / len) * 300;
    Sound.roll();
  }
  startSpecial() {
    this.setState("special");
    if (this.special >= 40) this.special -= 40;
    else { this.special = 0; this.hp = Math.max(1, this.hp - 8); }
    Sound.special();
    shake(6, 0.25);
  }

  resolveTimedStates() {
    const t = this.stateTime;
    if (this.state === "punch" && t > 0.30) this.setState("idle");
    else if (this.state === "kick" && t > 0.44) this.setState("idle");
    else if (this.state === "special" && t > 0.70) this.setState("idle");
    else if (this.state === "roll" && t > 0.34) this.setState("idle");
    else if (this.state === "hurt" && t > 0.32 && this.alt <= 0.001) this.setState("idle");
  }

  updateAttackHits() {
    const t = this.stateTime;
    if (this.state === "punch" && t > 0.07 && t < 0.18) {
      const last = this.comboStep === 0;
      const dmg = last ? 12 : 6;
      const knock = last ? 160 : 70;
      this.meleeHit(34, 26, dmg, knock, "#fff2a8");
    } else if (this.state === "kick" && t > 0.14 && t < 0.27) {
      this.meleeHit(44, 30, 13, 230, "#ffd27b");
    } else if (this.state === "special" && t > 0.14 && t < 0.46) {
      this.specialHit();
    } else if (this.state === "airpunch" && t > 0.04) {
      this.meleeHit(32, 28, 9, 150, "#fff2a8", 22, 56);   // reaches downward
    } else if (this.state === "airkick" && t > 0.04) {
      this.meleeHit(42, 32, 15, 250, "#ffd27b", 24, 60);  // dive kick, big downward reach
    }
  }

  // vUp / vDown = how far above / below the attacker's altitude the hit reaches
  meleeHit(range, depth, dmg, knock, color, vUp = 32, vDown = 14) {
    let connected = false;
    for (const e of game.enemies) {
      if (e.dead || this.hitSet.has(e)) continue;
      const dx = (e.worldX - this.worldX) * this.facing;
      if (dx < -8 || dx > range) continue;
      if (Math.abs(e.z - this.z) > depth) continue;
      const da = e.alt - this.alt;
      if (da > vUp || da < -vDown) continue;
      this.hitSet.add(e);
      e.takeDamage(dmg, this.worldX, knock * (KINDS[e.kind].knockTaken), this.facing, this);
      this.gainHit(6);
      this.score += 10;
      sparks(this.worldX + this.facing * range * 0.7, e.z - 30 - e.alt, color, 7);
      shake(3, 0.08);
      Sound.hit();
      connected = true;
    }
    return connected;
  }

  specialHit() {
    const radius = 78, depth = 40;
    for (const e of game.enemies) {
      if (e.dead || this.hitSet.has(e)) continue;
      if (Math.abs(e.worldX - this.worldX) > radius) continue;
      if (Math.abs(e.z - this.z) > depth) continue;
      this.hitSet.add(e);
      const dir = sign(e.worldX - this.worldX) || this.facing;
      e.takeDamage(20, this.worldX, 320 * KINDS[e.kind].knockTaken, dir, this);
      this.gainHit(2);
      this.score += 15;
      sparks(e.worldX, e.z - 30, "#9fe7ff", 10);
    }
  }

  applyPhysics(dt) {
    // move intent has no inertia; vx/vz is the knockback + roll channel and decays
    this.worldX += (this.vx + this.moveVX) * dt;
    this.z += (this.vz + this.moveVZ) * dt;
    const k = Math.exp(-DECAY * dt);
    this.vx *= k; this.vz *= k;
    // altitude (jump arc)
    if (this.alt > 0 || this.valt !== 0) {
      this.valt -= GRAV * dt;
      this.alt += this.valt * dt;
      if (this.alt <= 0) { this.alt = 0; this.valt = 0; this.onLand(); }
    }
    this.z = clamp(this.z, FLOOR_TOP, FLOOR_BOTTOM);
    const [l, r] = this.arenaBounds();
    this.worldX = clamp(this.worldX, l, r);
    collideObstacles(this, 9, 6);
    this.z = clamp(this.z, FLOOR_TOP, FLOOR_BOTTOM);
  }
}

/* ============================== Enemy =============================== */
class Enemy extends Actor {
  constructor(kind, x, z) {
    super(kind);
    const cfg = KINDS[kind];
    this.cfg = cfg;
    // pick the stage-appropriate palette (sewer recolor on Stage 2)
    this.pal = (game.theme === "sewer" && cfg.sewerPal) ? cfg.sewerPal : cfg.pal;
    this.isBoss = !!cfg.isBoss;
    this.behavior = cfg.behavior || "melee";
    this.maxHp = cfg.hp; this.hp = cfg.hp;
    this.worldX = x; this.z = z;
    this.attackCooldown = rand(0.4, 1.4);
    this.facing = -1;
    this.state = "approach";
    this.offX = rand(-30, 30);
    this.offZ = rand(-10, 10);
    this.repathTimer = rand(0.5, 1.5);
    this.attackName = "swipe";
    this.charging = false;
    this.enraged = false;
    if (this.behavior === "flyer") {
      this.hoverAlt = rand(cfg.hoverMin, cfg.hoverMax);
      this.alt = this.hoverAlt;
    }
    if (this.behavior === "gunner") this.attackCooldown = rand(cfg.fireMin, cfg.fireMax);
  }

  takeDamage(dmg, fromX, knock, fromFacing, attacker) {
    if (this.dead) return;
    if (attacker) this.lastAttacker = attacker;
    this.hp -= dmg;
    this.hitFlash = 0.14;
    this.vx = sign(this.worldX - fromX) * knock;
    // if interrupted mid-attack, give the attack token back (else tokens leak
    // and enemies eventually stop attacking entirely)
    if (!this.isBoss) { this.releaseToken(); this.setState("hurt"); }
    spawnText(this.worldX, this.z - 50 * this.cfg.scale, "-" + dmg, "#ffe27b");
    if (this.hp <= 0) {
      this.hp = 0; this.die();
      const credit = this.lastAttacker || game.players[0];
      if (credit) { credit.score += this.cfg.score; spawnText(this.worldX, this.z - 60, "+" + this.cfg.score, P_TAGCOLOR[credit.playerIndex] || "#fff"); }
    }
  }

  die() {
    this.dead = true;
    this.releaseToken();
    this.setState("dead");
    this.deadTimer = 0;
    const credit = this.lastAttacker;
    if (credit) credit.special = clamp(credit.special + 16, 0, credit.maxSpecial);
    Sound.die();
    sparks(this.worldX, this.z - 26, this.pal.eye, this.isBoss ? 26 : 12);
    if (this.isBoss) { shake(10, 0.6); explode(this.worldX, this.z - 40, 30); }
    else explode(this.worldX, this.z - 26, 8);
  }

  update(dt, player) {
    this.stateTime += dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    if (this.dead) {
      this.deadTimer += dt;
      this.worldX += this.vx * dt;
      this.vx *= Math.exp(-6 * dt);
      if (this.alt > 0) { this.valt -= GRAV * dt; this.alt += this.valt * dt; if (this.alt < 0) this.alt = 0; }
      this.z = clamp(this.z, FLOOR_TOP, FLOOR_BOTTOM);
      return;
    }

    if (this.isBoss) this.updateBoss(dt, player);
    else if (this.behavior === "gunner") this.updateGunner(dt, player);
    else if (this.behavior === "flyer") this.updateFlyer(dt, player);
    else this.updateGrunt(dt, player);

    this.separate();
    this.z = clamp(this.z, FLOOR_TOP, FLOOR_BOTTOM);
    // grounded grunts/gunners go around obstacles; flyers fly over, boss bulldozes through
    if (!this.isBoss && this.behavior !== "flyer") {
      collideObstacles(this, 9 * this.cfg.scale, 6);
      this.z = clamp(this.z, FLOOR_TOP, FLOOR_BOTTOM);
    }
  }

  /* ---- grunt AI ---- */
  updateGrunt(dt, player) {
    const cfg = this.cfg;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    this.repathTimer -= dt;
    if (this.repathTimer <= 0) { this.repathTimer = rand(0.6, 1.4); this.offX = rand(-10, 10); this.offZ = rand(-8, 8); }

    if (this.state === "hurt") {
      this.worldX += this.vx * dt; this.vx *= Math.exp(-7 * dt);
      if (this.stateTime > 0.3) this.setState("approach");
      return;
    }
    if (this.state === "windup") { this.tickAttackWindup(dt, player, cfg); return; }
    if (this.state === "strike") { this.tickAttackStrike(dt, player, cfg); return; }
    if (this.state === "recover") { if (this.stateTime > cfg.recover) this.setState("approach"); this.applyDrift(dt); return; }

    // approach — stand just inside striking range, lined up in depth
    const standoff = cfg.range - 10;
    const tx = player.worldX - this.facingToward(player) * standoff + this.offX;
    const tz = player.z + this.offZ;
    let dx = tx - this.worldX, dz = tz - this.z;
    const dist = Math.abs(player.worldX - this.worldX);
    this.facing = sign(player.worldX - this.worldX) || this.facing;

    // try to attack
    if (dist < cfg.range && Math.abs(player.z - this.z) < cfg.depth &&
        this.attackCooldown <= 0 && game.attackTokens > 0 && !player.dead) {
      game.attackTokens--; this.hasToken = true;
      this.setState("windup");
      return;
    }

    const len = Math.hypot(dx, dz) || 1;
    const sp = cfg.speed;
    this.worldX += (dx / len) * sp * dt;
    this.z += (dz / len) * sp * 0.7 * dt;
    this.setStateKeepAnim("approach");
    this.animClock += dt;
  }

  tickAttackWindup(dt, player, cfg) {
    this.facing = sign(player.worldX - this.worldX) || this.facing;
    if (this.stateTime > cfg.windup) { this.setState("strike"); Sound.whiff(); }
  }
  tickAttackStrike(dt, player, cfg) {
    const t = this.stateTime;
    if (t > 0 && t < cfg.active && !this.hitSet.has(player)) {
      const dx = (player.worldX - this.worldX) * this.facing;
      // jumping over a grounded attacker dodges it (altitude gap > reach)
      if (dx > -10 && dx < cfg.range && Math.abs(player.z - this.z) < cfg.depth &&
          Math.abs(player.alt - this.alt) < (cfg.vReach || 30)) {
        this.hitSet.add(player);
        player.takeDamage(cfg.dmg, this.worldX, cfg.atkKnock);
        if (this.kind === "brute") { shake(6, 0.2); Sound.stomp(); }
      }
    }
    if (t > cfg.active) {
      this.releaseToken();
      this.attackCooldown = rand(0.7, 1.5);
      this.setState("recover");
    }
  }

  releaseToken() { if (this.hasToken) { game.attackTokens++; this.hasToken = false; } }

  /* ---- gunner AI (laser robot): kite + shoot ---- */
  updateGunner(dt, player) {
    const cfg = this.cfg;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    this.facing = sign(player.worldX - this.worldX) || this.facing;

    if (this.state === "hurt") {
      this.worldX += this.vx * dt; this.vx *= Math.exp(-7 * dt);
      if (this.stateTime > 0.3) this.setState("approach");
      return;
    }
    if (this.state === "aim") {
      if (this.stateTime > cfg.aim) { this.fireLaser(player); this.setState("recover"); }
      return;
    }
    if (this.state === "recover") { if (this.stateTime > cfg.recover) this.setState("approach"); return; }

    // reposition to preferred firing distance, line up in depth
    const dxAbs = Math.abs(player.worldX - this.worldX);
    const dz = player.z - this.z;
    let mvx = 0;
    if (dxAbs < cfg.preferDist - 30) mvx = -sign(player.worldX - this.worldX); // back away
    else if (dxAbs > cfg.preferDist + 30) mvx = sign(player.worldX - this.worldX); // close in
    this.worldX += mvx * cfg.speed * dt;
    if (Math.abs(dz) > 6) this.z += sign(dz) * cfg.speed * 0.8 * dt;

    // fire when roughly at range, lined up, off cooldown
    if (this.attackCooldown <= 0 && Math.abs(dz) < 18 &&
        dxAbs > cfg.preferDist - 60 && dxAbs < cfg.preferDist + 80 && !player.dead) {
      this.setState("aim");
    } else {
      this.setStateKeepAnim("approach");
      this.animClock += dt;
    }
  }

  fireLaser(player) {
    const cfg = this.cfg;
    const dir = this.facing;
    game.projectiles.push({
      worldX: this.worldX + dir * 12, z: this.z, alt: 22,
      vx: dir * cfg.projSpeed, dmg: cfg.projDmg, life: 3.2,
      color: this.pal.eye, w: 12, h: 4, owner: "enemy",
    });
    this.attackCooldown = rand(cfg.fireMin, cfg.fireMax);
    Sound.laser();
    sparks(this.worldX + dir * 14, this.z - 22, this.pal.eye, 4);
  }

  /* ---- flyer AI: hover then swoop ---- */
  updateFlyer(dt, player) {
    const cfg = this.cfg;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    this.facing = sign(player.worldX - this.worldX) || this.facing;

    if (this.state === "hurt") {
      this.worldX += this.vx * dt; this.vx *= Math.exp(-7 * dt);
      this.alt = lerp(this.alt, this.hoverAlt, 1 - Math.exp(-6 * dt));
      if (this.stateTime > 0.28) this.setState("approach");
      return;
    }
    if (this.state === "windup") {           // rise & telegraph
      this.alt = lerp(this.alt, this.hoverAlt + 10, 1 - Math.exp(-8 * dt));
      if (this.stateTime > cfg.windup) { this.setState("strike"); Sound.whiff(); }
      return;
    }
    if (this.state === "strike") {           // swoop down at the player
      this.worldX += this.facing * cfg.speed * 1.1 * dt;
      const dz = player.z - this.z; if (Math.abs(dz) > 4) this.z += sign(dz) * 80 * dt;
      this.alt = lerp(this.alt, 2, 1 - Math.exp(-7 * dt));
      if (!this.hitSet.has(player) &&
          Math.abs(player.worldX - this.worldX) < cfg.range &&
          Math.abs(player.z - this.z) < cfg.depth &&
          Math.abs(player.alt - this.alt) < cfg.vReach) {
        this.hitSet.add(player);
        player.takeDamage(cfg.dmg, this.worldX, cfg.atkKnock);
      }
      if (this.stateTime > cfg.active) { this.releaseToken(); this.attackCooldown = rand(1.2, 2.2); this.setState("recover"); }
      return;
    }
    if (this.state === "recover") {           // climb back to hover height
      this.alt = lerp(this.alt, this.hoverAlt, 1 - Math.exp(-6 * dt));
      this.worldX -= this.facing * 30 * dt;
      if (this.stateTime > cfg.recover) this.setState("approach");
      return;
    }

    // approach: drift toward player while hovering and bobbing
    this.alt = this.hoverAlt + Math.sin(game.time * 3 + this.offX) * 4;
    const tx = player.worldX - this.facing * 18 + this.offX;
    const dx = tx - this.worldX, dz = (player.z + this.offZ) - this.z;
    const len = Math.hypot(dx, dz) || 1;
    this.worldX += (dx / len) * cfg.speed * dt;
    this.z += (dz / len) * cfg.speed * 0.6 * dt;
    this.setStateKeepAnim("approach");
    this.animClock += dt;

    if (this.attackCooldown <= 0 && Math.abs(player.worldX - this.worldX) < 70 &&
        Math.abs(player.z - this.z) < cfg.depth + 8 && game.attackTokens > 0 && !player.dead) {
      game.attackTokens--; this.hasToken = true;
      this.setState("windup");
    }
  }

  /* ---- boss AI ---- */
  updateBoss(dt, player) {
    const cfg = this.cfg;
    if (!this.enraged && this.hp < this.maxHp * 0.4) {
      this.enraged = true;
      spawnText(this.worldX, this.z - 110, this.cfg.name + ": OVERDRIVE!", "#ff4d4d");
      Sound.warn();
    }
    const spd = this.enraged ? cfg.speed * 1.6 : cfg.speed;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    if (this.state === "windup") return this.bossWindup(dt, player);
    if (this.state === "strike") return this.bossStrike(dt, player);
    if (this.state === "charge") return this.bossCharge(dt, player);
    if (this.state === "recover") { this.worldX += this.vx*dt; this.vx*=Math.exp(-6*dt); if (this.stateTime > (this.enraged?0.4:cfg.recover)) this.setState("approach"); return; }

    // approach / choose attack
    const dxAbs = Math.abs(player.worldX - this.worldX);
    this.facing = sign(player.worldX - this.worldX) || this.facing;
    if (this.attackCooldown <= 0 && !player.dead) {
      if (dxAbs > 150) this.attackName = "charge";
      else this.attackName = Math.random() < 0.4 ? "slam" : "swipe";
      this.setState("windup");
      this.windDur = this.attackName === "slam" ? 0.7 : (this.attackName === "charge" ? 0.45 : (this.enraged ? 0.32 : 0.5));
      if (this.enraged && this.attackName !== "charge") this.windDur *= 0.7;
      return;
    }
    // walk toward player
    const dz = player.z - this.z;
    this.worldX += sign(player.worldX - this.worldX) * spd * dt;
    if (Math.abs(dz) > 6) this.z += sign(dz) * spd * 0.6 * dt;
    this.setStateKeepAnim("approach");
    this.animClock += dt;
  }

  bossWindup(dt, player) {
    if (this.attackName !== "charge") this.facing = sign(player.worldX - this.worldX) || this.facing;
    if (this.stateTime > this.windDur) {
      if (this.attackName === "charge") {
        this.setState("charge");
        this.vx = this.facing * 520;
        Sound.kick();
      } else {
        this.setState("strike");
        Sound.whiff();
        if (this.attackName === "slam") { shake(8, 0.3); Sound.kick(); }
      }
    }
  }

  bossStrike(dt, player) {
    const cfg = this.cfg;
    const t = this.stateTime;
    const isSlam = this.attackName === "slam";
    const range = isSlam ? 80 : 60;
    const depth = isSlam ? 999 : 40;
    const dmg = isSlam ? 22 : 16;
    if (t < cfg.active && !this.hitSet.has(player)) {
      let inRange;
      if (isSlam) inRange = Math.abs(player.worldX - this.worldX) < range;
      else inRange = ((player.worldX - this.worldX) * this.facing) > -12 &&
                     ((player.worldX - this.worldX) * this.facing) < range &&
                     Math.abs(player.z - this.z) < depth;
      if (inRange) { this.hitSet.add(player); player.takeDamage(dmg, this.worldX, cfg.atkKnock); }
      if (isSlam) { for (let i=0;i<3;i++) sparks(this.worldX + rand(-50,50), this.z, "#ffd000", 4); }
    }
    if (t > cfg.active) { this.attackCooldown = this.enraged ? rand(0.5,1.0) : rand(1.1,2.0); this.setState("recover"); }
  }

  bossCharge(dt, player) {
    this.worldX += this.vx * dt;
    this.vx *= Math.exp(-1.3 * dt);
    // hit on contact
    if (!this.hitSet.has(player) &&
        Math.abs(player.worldX - this.worldX) < 46 &&
        Math.abs(player.z - this.z) < 38) {
      this.hitSet.add(player);
      player.takeDamage(18, this.worldX, 320);
    }
    // arena walls
    const halfW = 22 * this.cfg.scale;
    const minX = game.cameraX + halfW + 4, maxX = game.cameraX + CANVAS_W - halfW - 4;
    if (this.worldX < minX) { this.worldX = minX; this.vx = 0; }
    if (this.worldX > maxX) { this.worldX = maxX; this.vx = 0; }
    if (this.stateTime > 0.55 || Math.abs(this.vx) < 40) {
      this.attackCooldown = rand(0.8, 1.6);
      this.setState("recover");
    }
  }

  facingToward(player) { return sign(player.worldX - this.worldX) || 1; }
  setStateKeepAnim(s) { if (this.state !== s) { this.state = s; this.stateTime = 0; this.hitSet.clear(); } }
  applyDrift(dt) { this.worldX += this.vx * dt; this.vx *= Math.exp(-7 * dt); }

  separate() {
    for (const o of game.enemies) {
      if (o === this || o.dead) continue;
      const dx = this.worldX - o.worldX;
      const dz = this.z - o.z;
      const minX = 26 * Math.max(this.cfg.scale, 1), minZ = 16;
      if (Math.abs(dx) < minX && Math.abs(dz) < minZ) {
        const push = (minX - Math.abs(dx)) * 0.5;
        this.worldX += sign(dx || 1) * push * 0.5;
      }
    }
  }
}

/* ============================ Particles ============================ */
function sparks(x, z, color, n) {
  for (let i = 0; i < n; i++) {
    game.particles.push({ x, z, vx: rand(-90, 90), vz: rand(-90, 30), g: 240,
      life: rand(0.2, 0.5), max: 0.5, color, size: rand(1, 3) });
  }
}
function explode(x, z, n) {
  const cols = ["#ffd24a", "#ff7b2e", "#fff", "#ff4d2e"];
  for (let i = 0; i < n; i++) {
    game.particles.push({ x, z, vx: rand(-160,160), vz: rand(-180,40), g: 200,
      life: rand(0.3,0.8), max: 0.8, color: cols[(Math.random()*cols.length)|0], size: rand(2,5) });
  }
}
function spawnText(x, z, text, color) {
  game.texts.push({ x, z, text, color, life: 0.9, max: 0.9 });
}

/* ============================== Game =============================== */
const game = {
  state: "title",            // title | select | playing | paused | stageclear | gameover | win
  stageIndex: 0,
  stage: STAGES[0],
  rooms: STAGES[0].rooms,
  theme: "bridge",
  levelLength: STAGES[0].length,
  camMax: STAGES[0].camMax,
  cameraX: 0,
  cameraScrollMax: 0,
  roomIndex: 0,
  roomState: "approaching",  // approaching | fighting | cleared
  spawnQueue: [],
  spawnTimer: 0,
  spawnSide: 1,
  enemies: [],
  projectiles: [],
  obstacles: [],
  pickups: [],
  pizzasSpawned: 0,
  players: [],
  roster: [{ charIndex: 0, input: inputs[0] }],   // last-used selection (for retry)
  sel: null,                 // character-select screen state
  boss: null,
  particles: [],
  texts: [],
  attackTokens: 3,
  time: 0,
  shakeMag: 0, shakeTime: 0,
  goTimer: 0,
  warnTimer: 0,
  endTimer: 0,
  stageClearTimer: 0,
  titlePulse: 0,

  // build a fresh run (new players) starting at Stage 1
  reset(roster) {
    this.players = roster.map((r, i) => {
      const pl = new Player(r.charIndex, i, r.input);
      return pl;
    });
    this.loadStage(0);
  },

  // (re)load a stage's world; keeps existing players (heals + repositions them)
  loadStage(i) {
    this.stageIndex = i;
    const st = STAGES[i];
    this.stage = st;
    this.rooms = st.rooms;
    this.theme = st.theme;
    this.levelLength = st.length;
    this.camMax = st.camMax;
    this.cameraX = 0;
    this.cameraScrollMax = this.rooms[0].lockCam;
    this.roomIndex = 0;
    this.roomState = "approaching";
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.spawnSide = 1;
    this.enemies = [];
    this.projectiles = [];
    this.obstacles = st.obstacles.map((o) => ({ ...o, ...OBSTACLE_TYPES[o.type], obstacle: true }));
    this.pickups = [];
    this.pizzasSpawned = 0;
    this.boss = null;
    this.particles = [];
    this.texts = [];
    this.attackTokens = 3;
    this.goTimer = 0;
    this.warnTimer = 0;
    this.endTimer = 0;
    this.endTimerStart = undefined;
    this.players.forEach((pl, idx) => {
      if (pl.out) return;                 // spectating players stay out
      pl.worldX = 64 + idx * 40;
      pl.z = FLOOR_BOTTOM - 8 + idx * 10;
      pl.alt = 0; pl.valt = 0; pl.vx = 0; pl.vz = 0;
      pl.hp = pl.maxHp; pl.dead = false; pl.invuln = 1.2;
      pl.setState("idle");
    });
  },

  /* ----- character-select flow ----- */
  beginSelect() {
    this.state = "select";
    this.theme = "bridge";     // select screen shows the Stage 1 backdrop
    this.titlePulse = 0;
    this.sel = { slots: [
      { joined: true,  charIndex: 0, input: inputs[0], device: null },
      { joined: false, charIndex: 1 % CHARACTERS.length, input: inputs[1], device: null },
    ] };
    this.assignDevices();
  },
  assignDevices() {
    if (!this.sel) return;
    const pads = Pads.connected();
    const active = this.sel.slots.filter((s) => s.joined);
    let pc = 0; const kb = [];
    for (const s of active) {
      if (pc < pads.length) s.device = { type: "pad", index: pads[pc++] };
      else kb.push(s);
    }
    if (kb.length === 1) kb[0].device = KB_SOLO;
    else if (kb.length === 2) { kb[0].device = KB_LEFT; kb[1].device = KB_RIGHT; }
    for (const s of active) s.input.setDevice(s.device);
  },
  onDevicesChanged() { if (this.state === "select") this.assignDevices(); },
  navSlot(slot) {
    const I = slot.input;
    if (I.justPressed("left"))  { slot.charIndex = (slot.charIndex + CHARACTERS.length - 1) % CHARACTERS.length; Sound.pick(); }
    if (I.justPressed("right")) { slot.charIndex = (slot.charIndex + 1) % CHARACTERS.length; Sound.pick(); }
  },
  updateSelect(dt) {
    this.titlePulse += dt;
    const [p1, p2] = this.sel.slots;
    this.navSlot(p1);
    let joinedThisFrame = false;
    if (!p2.joined) {
      const pads = Pads.connected();
      const p1Pad = (p1.device && p1.device.type === "pad") ? p1.device.index : -1;
      const freePads = pads.filter((i) => i !== p1Pad);
      for (const i of freePads) if (Pads.anyButton(i)) joinedThisFrame = true;
      if (!freePads.length && KB.down.has("Slash")) joinedThisFrame = true;
      if (joinedThisFrame) { p2.joined = true; this.assignDevices(); Sound.start(); }
    } else {
      this.navSlot(p2);
    }
    if (Menu.jp("back")) { this.state = "title"; this.titlePulse = 0; return; }
    if (!joinedThisFrame && Menu.jp("start")) this.startGame();
  },
  startGame() {
    this.roster = this.sel.slots.filter((s) => s.joined).map((s) => ({ charIndex: s.charIndex, input: s.input }));
    this.numPlayers = this.roster.length;
    this.reset(this.roster);
    this.state = "playing";
    Sound.start();
  },
  restart() { this.reset(this.roster); this.state = "playing"; Sound.start(); },
  toGameOver() { this.state = "gameover"; this.endTimer = 0; Sound.gameover(); },
  toWin() { this.state = "win"; this.endTimer = 0; Sound.win(); },
  // boss down but more stages remain -> intermission, then advance
  nextStage() { this.state = "stageclear"; this.stageClearTimer = 0; Sound.win(); },
  advanceStage() { this.loadStage(this.stageIndex + 1); this.state = "playing"; Sound.go(); },

  alivePlayers() { return this.players.filter((pl) => !pl.out); },
  nearestPlayer(actor) {
    let best = null, bd = 1e9;
    for (const pl of this.players) {
      if (pl.out || pl.dead) continue;
      const d = Math.abs(pl.worldX - actor.worldX) + Math.abs(pl.z - actor.z) * 0.5;
      if (d < bd) { bd = d; best = pl; }
    }
    return best || this.players.find((pl) => !pl.out) || this.players[0];
  },
  spawnPizza() {
    this.pizzasSpawned++;
    this.pickups.push({ worldX: this.cameraX + CANVAS_W * 0.5, z: FLOOR_BOTTOM - 26, bobT: 0, taken: false, pickup: true });
    spawnText(this.cameraX + CANVAS_W * 0.5, FLOOR_BOTTOM - 60, "PIZZA!", "#ffd24a");
  },

  beginRoom() {
    const room = this.rooms[this.roomIndex];
    this.spawnQueue = room.spawns.slice();
    this.spawnTimer = 0.4;
    this.roomState = "fighting";
    if (room.boss) { this.warnTimer = 2.2; Sound.warn(); }
  },

  trySpawn(dt) {
    if (this.roomState !== "fighting" || this.spawnQueue.length === 0) return;
    const room = this.rooms[this.roomIndex];
    this.spawnTimer -= dt;
    const limit = room.boss ? 1 : MAX_CONCURRENT;
    if (this.spawnTimer <= 0 && this.enemies.length < limit) {
      const kind = this.spawnQueue.shift();
      const fromRight = this.spawnSide > 0; this.spawnSide *= -1;
      const x = fromRight ? this.cameraX + CANVAS_W + 24 : this.cameraX - 24;
      const z = rand(FLOOR_TOP + 6, FLOOR_BOTTOM);
      const e = new Enemy(kind, x, z);
      e.facing = fromRight ? -1 : 1;
      if (e.isBoss) { e.worldX = this.cameraX + CANVAS_W + 40; this.boss = e; }
      this.enemies.push(e);
      this.spawnTimer = room.boss ? 0 : rand(0.7, 1.4);
    }
  },

  roomCleared() {
    return this.roomState === "fighting" &&
           this.spawnQueue.length === 0 &&
           this.enemies.every((e) => e.dead);
  },

  update(dt) {
    this.time += dt;
    this.titlePulse += dt;
    if (this.shakeTime > 0) this.shakeTime -= dt;
    if (this.goTimer > 0) this.goTimer -= dt;
    if (this.warnTimer > 0) this.warnTimer -= dt;

    if (this.state !== "playing") { this.endTimer += dt; return; }

    for (const pl of this.players) pl.update(dt);
    if (this.players.every((pl) => pl.out)) { this.toGameOver(); return; }

    // room progression
    if (this.roomState === "approaching" && this.cameraX >= this.cameraScrollMax - 0.5) {
      this.beginRoom();
    }
    this.trySpawn(dt);
    if (this.roomCleared()) {
      const room = this.rooms[this.roomIndex];
      if (room.boss) {
        if (this.endTimerStart === undefined) this.endTimerStart = this.time;
        if (this.time - this.endTimerStart > 1.4) {
          if (this.stageIndex < STAGES.length - 1) this.nextStage();   // more stages to come
          else this.toWin();                                           // final stage cleared
        }
      } else {
        if (room.pizza && this.pizzasSpawned < 2) this.spawnPizza();
        this.roomState = "cleared";
        this.roomIndex++;
        this.cameraScrollMax = this.rooms[this.roomIndex].lockCam;
        this.roomState = "approaching";
        this.goTimer = 2.2;
        Sound.go();
      }
    }

    // enemies (each targets the nearest living player)
    for (const e of this.enemies) e.update(dt, this.nearestPlayer(e));
    this.enemies = this.enemies.filter((e) => !(e.dead && e.deadTimer > 1.2));

    // projectiles (laser bolts) — can hit any living player
    for (const pr of this.projectiles) {
      pr.worldX += pr.vx * dt;
      pr.life -= dt;
      if (pr.dead) continue;
      if (pr.owner === "enemy") {
        for (const pl of this.players) {
          if (pl.out || pl.dead) continue;
          const pCenter = pl.alt + 22, bolt = pr.alt + 2;   // body band check for jump-dodge
          if (Math.abs(pr.worldX - pl.worldX) < 12 && Math.abs(pr.z - pl.z) < 14 &&
              Math.abs(bolt - pCenter) < 22) {
            pl.takeDamage(pr.dmg, pr.worldX, 130);
            pr.dead = true;
            sparks(pr.worldX, pr.z - pr.alt, pr.color, 6);
            break;
          }
        }
      }
    }
    this.projectiles = this.projectiles.filter((pr) =>
      !pr.dead && pr.life > 0 &&
      pr.worldX - this.cameraX > -50 && pr.worldX - this.cameraX < CANVAS_W + 50);

    // healing pizzas — walk over one to eat it
    for (const pk of this.pickups) {
      pk.bobT += dt;
      for (const pl of this.players) {
        if (pl.out || pl.dead || pl.alt > 26) continue;
        if (Math.abs(pl.worldX - pk.worldX) < 16 && Math.abs(pl.z - pk.z) < 16) {
          pk.taken = true;
          pl.hp = Math.min(pl.maxHp, pl.hp + 50);
          Sound.pizza();
          spawnText(pk.worldX, pk.z - 44, "+50 HP", "#36d35a");
          sparks(pk.worldX, pk.z - 16, "#ffd24a", 10);
          break;
        }
      }
    }
    this.pickups = this.pickups.filter((pk) => !pk.taken);

    // camera follows the average of living players, clamped to current scroll max
    const alive = this.alivePlayers();
    const avgX = alive.length ? alive.reduce((s, pl) => s + pl.worldX, 0) / alive.length : this.cameraX + CANVAS_W * 0.42;
    const target = avgX - CANVAS_W * 0.42;
    this.cameraX = clamp(lerp(this.cameraX, target, 1 - Math.exp(-8 * dt)), 0, Math.min(this.cameraScrollMax, this.camMax));

    // particles & texts
    for (const pt of this.particles) {
      pt.x += pt.vx * dt; pt.z += pt.vz * dt; pt.vz += pt.g * dt; pt.life -= dt;
    }
    this.particles = this.particles.filter((pt) => pt.life > 0 && pt.z < FLOOR_BOTTOM + 30);
    for (const tx of this.texts) { tx.z -= 26 * dt; tx.life -= dt; }
    this.texts = this.texts.filter((t) => t.life > 0);
  },
};

function shake(mag, time) { if (mag > game.shakeMag || game.shakeTime <= 0) { game.shakeMag = mag; } game.shakeTime = Math.max(game.shakeTime, time); }

/* ============================ Rendering ============================ */
function drawBackground() {
  if (game.theme === "sewer") drawSewerBackground();
  else drawBridgeBackground();
}

function drawBridgeBackground() {
  const cam = game.cameraX;
  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, 150);
  sky.addColorStop(0, "#2b7fc4");
  sky.addColorStop(1, "#7cc6f0");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, CANVAS_W, 150);

  // distant skyline silhouette (slow parallax)
  ctx.fillStyle = "#2d5d8f";
  const off1 = -(cam * 0.18) % 120;
  for (let x = off1 - 120; x < CANVAS_W + 120; x += 120) {
    ctx.fillRect(px(x), 70, 26, 50);
    ctx.fillRect(px(x + 40), 56, 18, 64);
    ctx.fillRect(px(x + 74), 80, 30, 40);
  }

  // classical temple wall (pink/red) — mid parallax, matches inspiration
  const off2 = -(cam * 0.4) % 96;
  ctx.fillStyle = "#b6516a";
  ctx.fillRect(0, 92, CANVAS_W, 40);
  ctx.fillStyle = "#8f3a52";
  ctx.fillRect(0, 92, CANVAS_W, 6);            // top trim
  ctx.fillStyle = "#d98ba0";                    // columns
  for (let x = off2 - 96; x < CANVAS_W + 96; x += 96) {
    ctx.fillRect(px(x), 98, 12, 30);
    ctx.fillStyle = "#c3697f";
    ctx.fillRect(px(x) + 12, 98, 4, 30);
    ctx.fillStyle = "#d98ba0";
  }
  ctx.fillStyle = "#7a3047";
  ctx.fillRect(0, 130, CANVAS_W, 4);

  // bridge towers + suspension cables (parallax 0.6)
  const off3 = -(cam * 0.6);
  ctx.strokeStyle = "#36506e"; ctx.lineWidth = 2;
  for (let bx = -200; bx < game.levelLength; bx += 520) {
    const sx = px(bx + off3);
    if (sx < -60 || sx > CANVAS_W + 60) continue;
    ctx.fillStyle = "#3f5a78";
    ctx.fillRect(sx, 40, 14, 96);
    ctx.fillRect(sx + 30, 40, 14, 96);
    ctx.fillStyle = "#52708f";
    ctx.fillRect(sx, 56, 44, 8);
    ctx.fillRect(sx, 78, 44, 8);
    // cables
    ctx.beginPath();
    ctx.moveTo(sx + 7, 40);
    ctx.quadraticCurveTo(sx + 130, 130, sx + 260, 44);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx + 37, 40);
    ctx.quadraticCurveTo(sx - 90, 130, sx - 220, 44);
    ctx.stroke();
  }

  // water strip
  ctx.fillStyle = "#1d437f"; ctx.fillRect(0, 134, CANVAS_W, 12);
  ctx.fillStyle = "#2b5aa0";
  for (let i = 0; i < CANVAS_W; i += 16) {
    if (((i + Math.floor(game.time * 30)) % 32) < 16) ctx.fillRect(i, 138, 8, 2);
  }

  // === road (1:1 with camera) ===
  ctx.fillStyle = "#9aa1aa"; ctx.fillRect(0, 146, CANVAS_W, PLAY_H - 146);
  // back curb / guard rail
  ctx.fillStyle = "#6f7682"; ctx.fillRect(0, 146, CANVAS_W, 8);
  const railOff = -(cam) % 48;
  ctx.fillStyle = "#c2c8d0";
  for (let x = railOff - 48; x < CANVAS_W + 48; x += 48) {
    ctx.fillRect(px(x), 138, 5, 12);          // rail posts
  }
  ctx.fillStyle = "#8b929c"; ctx.fillRect(0, 150, CANVAS_W, 3);

  // road shading bands for depth
  const g2 = ctx.createLinearGradient(0, 154, 0, PLAY_H);
  g2.addColorStop(0, "#8b929c");
  g2.addColorStop(0.5, "#a7adb6");
  g2.addColorStop(1, "#7d838d");
  ctx.fillStyle = g2; ctx.fillRect(0, 154, CANVAS_W, PLAY_H - 154);

  // expansion joints + lane dashes (scroll with camera)
  ctx.fillStyle = "#6b7079";
  const jOff = -(cam) % 128;
  for (let x = jOff - 128; x < CANVAS_W + 128; x += 128) ctx.fillRect(px(x), 154, 3, PLAY_H - 154);
  // center dashed line
  ctx.fillStyle = "#e7e9b0";
  const dOff = -(cam) % 64;
  for (let x = dOff - 64; x < CANVAS_W + 64; x += 64) ctx.fillRect(px(x), 196, 26, 4);

  // a few cracks for texture
  ctx.strokeStyle = "rgba(60,66,74,0.6)"; ctx.lineWidth = 1;
  const seeds = [200, 540, 980, 1320, 1700, 2100, 2480, 2900, 3200, 3600, 3980, 4350, 4720, 5050, 5300];
  for (const s of seeds) {
    const sx = px(s - cam);
    if (sx < -20 || sx > CANVAS_W + 20) continue;
    ctx.beginPath();
    ctx.moveTo(sx, 168); ctx.lineTo(sx + 10, 184); ctx.lineTo(sx + 2, 206); ctx.lineTo(sx + 16, 224);
    ctx.stroke();
  }
}

function drawSewerBackground() {
  const cam = game.cameraX;
  // dank backdrop
  const g = ctx.createLinearGradient(0, 0, 0, 148);
  g.addColorStop(0, "#0c130b"); g.addColorStop(1, "#20301a");
  ctx.fillStyle = g; ctx.fillRect(0, 0, CANVAS_W, 148);

  // brick back wall with mortar grid (parallax 0.3)
  ctx.fillStyle = "#3b4226"; ctx.fillRect(0, 36, CANVAS_W, 96);
  ctx.fillStyle = "#2a301a";
  const bh = 14;
  for (let r = 0; r < 7; r++) {
    const y = 36 + r * bh;
    ctx.fillRect(0, y, CANVAS_W, 1);
    const off = (-(cam * 0.3) % 60) + (r % 2 ? 30 : 0);
    for (let x = off - 60; x < CANVAS_W + 60; x += 60) ctx.fillRect(px(x), y, 1, bh);
  }
  ctx.fillStyle = "rgba(18,28,10,0.35)";
  const stO = -(cam * 0.3) % 160;
  for (let x = stO - 160; x < CANVAS_W + 160; x += 160) ctx.fillRect(px(x), 36, 12, 96);

  // dark arch alcoves with a faint green glow (parallax 0.45)
  const aO = -(cam * 0.45) % 230;
  for (let x = aO - 230; x < CANVAS_W + 230; x += 230) {
    const ax = px(x);
    ctx.fillStyle = "#0a120a";
    ctx.beginPath();
    ctx.moveTo(ax, 126); ctx.lineTo(ax, 82); ctx.quadraticCurveTo(ax + 24, 56, ax + 48, 82); ctx.lineTo(ax + 48, 126); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(120,255,80,0.10)"; ctx.fillRect(ax + 9, 96, 30, 30);
  }

  // big pipes across the wall (parallax 0.6) with flanges
  const pipe = (y, h, c1, c2, c3) => {
    ctx.fillStyle = c1; ctx.fillRect(0, y, CANVAS_W, h);
    ctx.fillStyle = c2; ctx.fillRect(0, y, CANVAS_W, 2);
    ctx.fillStyle = c3; ctx.fillRect(0, y + h - 2, CANVAS_W, 2);
    const o = -(cam * 0.6) % 120;
    ctx.fillStyle = c3;
    for (let x = o - 120; x < CANVAS_W + 120; x += 120) ctx.fillRect(px(x), y - 1, 7, h + 2);
  };
  pipe(66, 11, "#525c33", "#6c7846", "#343a1e");
  pipe(112, 8, "#47502c", "#5e6a3a", "#2c3119");

  // toxic water channel
  ctx.fillStyle = "#2a4420"; ctx.fillRect(0, 132, CANVAS_W, 16);
  ctx.fillStyle = "#3c5e29";
  for (let i = 0; i < CANVAS_W; i += 16) if (((i + Math.floor(game.time * 24)) % 32) < 16) ctx.fillRect(i, 136, 9, 2);
  ctx.fillStyle = "#7fc24a";
  for (let i = 0; i < CANVAS_W; i += 40) if (((i + Math.floor(game.time * 44)) % 80) < 6) ctx.fillRect(i, 140, 4, 1);
  ctx.fillStyle = "#1c3016"; ctx.fillRect(0, 132, CANVAS_W, 2);

  // === floor (1:1 with camera) ===
  const f = ctx.createLinearGradient(0, 148, 0, PLAY_H);
  f.addColorStop(0, "#566048"); f.addColorStop(0.5, "#6a745a"); f.addColorStop(1, "#444c39");
  ctx.fillStyle = f; ctx.fillRect(0, 148, CANVAS_W, PLAY_H - 148);
  ctx.fillStyle = "#3e4632"; ctx.fillRect(0, 148, CANVAS_W, 4);     // ledge edge
  ctx.fillStyle = "#717c5e"; ctx.fillRect(0, 152, CANVAS_W, 2);

  // tile joints
  ctx.fillStyle = "#3c4432";
  const jO = -(cam) % 96;
  for (let x = jO - 96; x < CANVAS_W + 96; x += 96) ctx.fillRect(px(x), 152, 2, PLAY_H - 152);
  ctx.fillRect(0, 192, CANVAS_W, 1);

  // grates, manholes, slime puddles
  const props = [
    { x: 260, t: "grate" }, { x: 700, t: "manhole" }, { x: 1150, t: "slime" }, { x: 1600, t: "grate" },
    { x: 2050, t: "manhole" }, { x: 2500, t: "slime" }, { x: 2950, t: "grate" }, { x: 3400, t: "manhole" },
    { x: 3850, t: "slime" }, { x: 4300, t: "grate" }, { x: 4750, t: "manhole" },
  ];
  for (const p of props) {
    const sx = px(p.x - cam);
    if (sx < -40 || sx > CANVAS_W + 40) continue;
    if (p.t === "grate") {
      ctx.fillStyle = "#2f3526"; ctx.fillRect(sx, 206, 34, 16);
      ctx.fillStyle = "#566048"; for (let i = 0; i < 5; i++) ctx.fillRect(sx + 2 + i * 7, 207, 4, 14);
    } else if (p.t === "manhole") {
      ctx.fillStyle = "#3a4230"; ctx.beginPath(); ctx.ellipse(sx, 212, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#4e5840"; ctx.beginPath(); ctx.ellipse(sx, 211, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = "rgba(120,200,60,0.45)"; ctx.beginPath(); ctx.ellipse(sx, 214, 18, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(180,255,90,0.5)"; ctx.beginPath(); ctx.ellipse(sx - 4, 213, 6, 2, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawShadow(sx, sy, w) {
  ctx.fillStyle = "rgba(0,0,0,0.30)";
  ctx.beginPath();
  ctx.ellipse(px(sx), px(sy), w, w * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
}

/* ---- pixel-art primitives (call inside a translated/scaled context) ---- */
function pr(x, y, w, h, c) {            // plain pixel rect
  ctx.fillStyle = c;
  ctx.fillRect(px(x), px(y), Math.max(1, px(w)), Math.max(1, px(h)));
}
function bev(x, y, w, h, mid, hi, sh) { // beveled block: light top/left, dark bottom/right
  x = px(x); y = px(y); w = Math.max(1, px(w)); h = Math.max(1, px(h));
  ctx.fillStyle = mid; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = hi;  ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = sh;  ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x + w - 1, y, 1, h);
}
function out(x, y, w, h, c) {           // 1px outline frame around a rect
  x = px(x); y = px(y); w = px(w); h = px(h);
  ctx.fillStyle = c;
  ctx.fillRect(x - 1, y, 1, h); ctx.fillRect(x + w, y, 1, h);
  ctx.fillRect(x, y - 1, w, 1); ctx.fillRect(x, y + h, w, 1);
}

/* generic helper to get walk leg phase */
function legPhase(actor) {
  const moving = actor.state === "walk" || actor.state === "approach";
  return moving ? Math.sin(actor.animClock * 12) : 0;
}

/* ============================ Hero (KAI) ============================ */
function heroLeg(cx, C) {
  bev(cx - 2, -16, 5, 11, C.sk, C.skH, C.skS);   // leg
  pr(cx - 2, -11, 5, 2, C.pdS);                   // knee
  out(cx - 3, -7, 6, 7, C.o);
  bev(cx - 3, -7, 6, 7, C.bt, C.btH, C.btS);      // boot (foot at y=0)
  pr(cx - 3, -1, 7, 1, C.btS);
}
function drawHero(p) {
  const sx = p.screenX, sy = p.z, f = p.facing, alt = p.alt || 0;
  drawShadow(sx, sy, 12 * (1 - Math.min(alt, 70) / 130));
  ctx.save();
  ctx.translate(px(sx), px(sy - alt));
  if (p.invuln > 0 && !p.dead && Math.floor(game.time * 20) % 2 === 0) ctx.globalAlpha = 0.4;
  ctx.scale(f, 1);

  const C = p.pal || CHARACTERS[0].pal;

  const t = p.stateTime;
  const lp = legPhase(p);
  let armExt = 0, kick = 0, lean = 0, crouch = 0, block = false, special = false;
  if (p.state === "punch") { const k = clamp(t / 0.30, 0, 1); armExt = Math.sin(k * Math.PI) * 15; lean = Math.sin(k * Math.PI) * 2; }
  else if (p.state === "kick") { const k = clamp(t / 0.44, 0, 1); kick = Math.sin(k * Math.PI) * 18; lean = -Math.sin(k * Math.PI) * 2; }
  else if (p.state === "block") { block = true; crouch = 2; }
  else if (p.state === "special") { special = true; crouch = Math.sin(clamp(t / 0.7, 0, 1) * Math.PI) * 3; }
  else if (p.state === "hurt") { lean = 5; }
  else if (p.state === "jump") { crouch = 5; lean = 1; }
  else if (p.state === "airpunch") { armExt = 15; crouch = 4; lean = 3; }
  else if (p.state === "airkick") { kick = 19; lean = -4; crouch = 1; }
  else if (p.state === "roll") {
    const k = clamp(t / 0.34, 0, 1);
    ctx.translate(0, -13); ctx.rotate(f * k * Math.PI * 2); ctx.translate(0, 13);
    crouch = 13;
  } else if (p.state === "dead") {
    ctx.translate(0, -10); ctx.rotate(-1.2);
  }

  const bob = (p.state === "walk") ? Math.abs(Math.sin(p.animClock * 12)) * 1.5 : Math.sin(game.time * 3) * 0.5;
  const up = crouch - bob;
  const tx = lean * 0.5;
  const ty = -28 + up, th = 12;     // torso
  const shY = ty + 2;               // shoulder
  const hy = -39 + up;              // head

  // --- special aura (behind) ---
  if (special && t > 0.12 && t < 0.5) {
    const r = 26 + Math.sin(t * 30) * 5;
    ctx.save(); ctx.globalAlpha *= 0.5;
    ctx.fillStyle = "rgba(120,210,255,0.6)";
    ctx.beginPath(); ctx.ellipse(0, -16, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // --- back arm (behind torso) ---
  bev(-8, shY, 4, 8, C.skS, C.sk, C.skS);

  // --- legs ---
  if (kick > 0) {
    heroLeg(-3, C);                                       // planted
    bev(2, -12, 6, 7, C.sk, C.skH, C.skS);               // kicking thigh
    bev(7, -10, 8 + kick, 5, C.bt, C.btH, C.btS);        // shin/boot forward
    out(7, -10, 8 + kick, 5, C.o);
    pr(7 + 8 + kick - 4, -11, 5, 6, C.btS);              // toe
  } else {
    heroLeg(-3 - lp * 2, C);
    heroLeg(3 + lp * 2, C);
  }

  // --- torso ---
  out(tx - 7, ty, 14, th, C.o);
  bev(tx - 7, ty, 14, th, C.sk, C.skH, C.skS);
  bev(tx - 5, ty + 1, 10, 6, C.pd, "#e0bd66", C.pdS);    // chest guard
  pr(tx - 1, ty + 1, 2, 6, C.pdS);
  bev(tx - 7, ty + th - 2, 14, 3, C.bl, C.blH, C.blS);   // belt
  pr(tx - 1, ty + th - 2, 3, 3, C.blS);                  // buckle
  bev(tx - 8, ty - 1, 5, 4, C.bd, C.bdH, C.bdS);         // shoulder pads
  bev(tx + 3, ty - 1, 5, 4, C.bd, C.bdH, C.bdS);

  // --- head ---
  const hx = tx + lean * 0.3;
  out(hx - 6, hy, 12, 10, C.o);
  bev(hx - 6, hy, 12, 10, C.sk, C.skH, C.skS);
  pr(hx - 6, hy + 8, 12, 2, C.skS);                      // jaw shade
  bev(hx - 7, hy + 2, 14, 4, C.bd, C.bdH, C.bdS);        // bandana band
  const fl = Math.sin(game.time * 9) * 1.5;              // fluttering tails
  pr(hx - 9, hy + 2, 3, 3, C.bdS);
  pr(hx - 13, hy + 2 + fl, 5, 2, C.bd);
  pr(hx - 12, hy + 5 - fl, 4, 2, C.bdS);
  pr(hx + 0, hy + 4, 4, 3, C.eye);                       // near eye
  pr(hx + 2, hy + 4, 2, 3, C.pp);
  pr(hx - 3, hy + 4, 2, 3, C.eye);                       // far eye
  pr(hx + 0, hy + 8, 4, 1, C.skS);                       // mouth

  // --- front arm / action ---
  if (block) {
    out(5, ty - 3, 5, 13, C.o);
    bev(5, ty - 3, 5, 13, C.pd, "#e0bd66", C.pdS);       // raised guard
    bev(4, ty - 4, 7, 3, C.bd, C.bdH, C.bdS);
  } else if (special && t > 0.1 && t < 0.55) {
    bev(6, shY - 1, 6, 5, C.sk, C.skH, C.skS);
    bev(11, shY - 2, 6, 6, C.bl, C.blH, C.blS);
  } else {
    bev(4, shY, 4, 5, C.sk, C.skH, C.skS);               // upper arm
    bev(7, shY + 1, 4 + armExt, 4, C.sk, C.skH, C.skS);  // forearm
    out(7, shY + 1, 4 + armExt, 4, C.o);
    bev(7 + 4 + armExt - 1, shY, 5, 6, C.bl, C.blH, C.blS); // fist/glove
  }

  if (p.hitFlash > 0) { ctx.save(); ctx.globalAlpha *= 0.6; ctx.fillStyle = "#fff"; ctx.fillRect(-9, hy, 18, 42 - up); ctx.restore(); }
  ctx.restore();

  // player-number tag above head (only in co-op)
  if (p.playerIndex >= 0 && game.players.length > 1 && !p.dead) {
    const tag = "P" + (p.playerIndex + 1);
    ctx.font = "bold 9px monospace"; ctx.textAlign = "center";
    const ty2 = px(sy - alt) - 44;
    ctx.fillStyle = "#000"; ctx.fillText(tag, px(sx) + 1, ty2 + 1);
    ctx.fillStyle = P_TAGCOLOR[p.playerIndex] || "#fff"; ctx.fillText(tag, px(sx), ty2);
    ctx.textAlign = "left";
  }
}

/* ============================ Robot grunt ============================ */
function mechLeg(cx, P) {
  bev(cx - 2, -15, 5, 10, P.dark, P.metal, "#10131a");
  pr(cx - 2, -11, 5, 2, P.mSh);
  out(cx - 3, -5, 7, 5, "#10131a");
  bev(cx - 3, -5, 7, 5, P.metal, P.mHi, P.mSh);
}
function drawDrone(e) {
  const sx = e.screenX, sy = e.z, f = e.facing, alt = e.alt || 0;
  drawShadow(sx, sy, 11 * (1 - Math.min(alt, 70) / 130));
  ctx.save();
  ctx.translate(px(sx), px(sy - alt));
  ctx.scale(f, 1);
  const P = e.pal, t = e.stateTime, lp = legPhase(e);
  const windup = e.state === "windup", strike = e.state === "strike";
  let claw = 0, lean = 0;
  if (windup) { const k = clamp(t / e.cfg.windup, 0, 1); claw = -6 * Math.sin(k * Math.PI * 0.5); lean = -3 * k; }
  else if (strike) { const k = clamp(t / e.cfg.active, 0, 1); claw = 16 * Math.sin(k * Math.PI); lean = 3 * Math.sin(k * Math.PI); }
  else if (e.state === "hurt") { lean = 5; }
  if (e.state === "dead") { ctx.translate(0, -9); ctx.rotate(1.2); ctx.globalAlpha = clamp(1 - e.deadTimer / 1.2, 0, 1); }

  const bob = (e.state === "approach") ? Math.abs(Math.sin(e.animClock * 12)) * 1.2 : 0;
  const up = -bob;
  const tx = lean * 0.5, ty = -25 + up, th = 11;
  const hy = -33 + up;

  // legs
  mechLeg(-3 - lp * 2, P);
  mechLeg(3 + lp * 2, P);

  // back arm
  bev(-8, ty + 2, 4, 7, P.mSh, P.metal, "#10131a");

  // torso
  out(tx - 7, ty, 14, th, "#10131a");
  bev(tx - 7, ty, 14, th, P.metal, P.mHi, P.mSh);
  bev(tx - 5, ty + 2, 10, 5, P.trim, P.trimHi, P.trimSh);  // chest grille
  pr(tx - 5, ty + 3, 10, 1, P.mSh); pr(tx - 5, ty + 5, 10, 1, P.mSh);
  pr(tx - 7, ty + th - 2, 14, 2, P.dark);                  // waist seam
  bev(tx - 9, ty - 1, 4, 5, P.mSh, P.metal, "#10131a");    // shoulder bolts
  bev(tx + 5, ty - 1, 4, 5, P.mSh, P.metal, "#10131a");
  pr(tx - 8, ty + 1, 2, 2, P.dark); pr(tx + 6, ty + 1, 2, 2, P.dark);

  // head
  const hx = tx + lean * 0.3;
  out(hx - 5, hy, 11, 8, "#10131a");
  bev(hx - 5, hy, 11, 8, P.metal, P.mHi, P.mSh);
  pr(hx - 5, hy + 3, 11, 4, P.dark);                       // visor band
  const eyeOn = windup ? (Math.sin(game.time * 40) > 0) : true;
  if (eyeOn) {
    ctx.save(); ctx.globalAlpha *= 0.5; pr(hx - 1, hy + 3, 7, 4, P.eye); ctx.restore();
    pr(hx + 0, hy + 4, 5, 2, windup ? "#ffffff" : P.eye);
  }
  pr(hx - 1, hy - 3, 2, 3, P.dark); pr(hx - 2, hy - 5, 4, 2, P.eye);  // antenna

  // front arm + claw
  const ay = ty + 3, ce = Math.max(0, claw);
  bev(5, ay, 4, 4, P.metal, P.mHi, P.mSh);
  bev(8, ay + 1, 5 + ce, 4, P.dark, P.metal, "#10131a");
  out(8, ay + 1, 5 + ce, 4, "#10131a");
  const cxp = 8 + 5 + ce;
  bev(cxp - 1, ay - 1, 4, 7, P.trim, P.trimHi, P.trimSh); // claw
  pr(cxp + 1, ay - 2, 1, 3, P.eye);

  if (e.hitFlash > 0) { ctx.save(); ctx.globalAlpha *= 0.7; ctx.fillStyle = "#fff"; ctx.fillRect(-9, hy, 18, 40); ctx.restore(); }
  ctx.restore();

  if (windup) {
    ctx.fillStyle = Math.sin(game.time * 30) > 0 ? "#ff3b30" : "#ffd000";
    ctx.font = "bold 13px monospace";
    ctx.fillText("!", px(sx) - 3, px(sy) - 44);
  }
}

/* ============================ Boss (TITAN-X) ============================ */
function bossLeg(cx, P) {
  bev(cx, -28, 11, 20, P.dark, P.metal, "#0c0f15");
  pr(cx, -20, 11, 2, P.mSh);
  out(cx - 1, -10, 13, 10, "#0c0f15");
  bev(cx - 1, -10, 13, 10, P.metal, P.mHi, P.mSh);
  pr(cx - 1, -2, 13, 2, P.dark);
}
function bossShoulder(x, y, P) {
  out(x, y, 10, 14, "#0c0f15");
  bev(x, y, 10, 14, P.metal, P.mHi, P.mSh);
  bev(x, y, 10, 4, P.trim, P.trimHi, P.trimSh);
  pr(x + 2, y + 7, 6, 5, P.dark);
}
function drawBoss(e) {
  const sx = e.screenX, sy = e.z, f = e.facing, alt = e.alt || 0;
  drawShadow(sx, sy, 24);
  ctx.save();
  ctx.translate(px(sx), px(sy - alt));
  ctx.scale(f, 1);
  const P = e.pal, enr = e.enraged, t = e.stateTime;
  const windup = e.state === "windup", strike = e.state === "strike", charge = e.state === "charge";
  let armF = 0, armUp = 0, lean = 0;
  if (windup) {
    const k = clamp(t / (e.windDur || 0.5), 0, 1);
    if (e.attackName === "slam") armUp = -16 * Math.sin(k * Math.PI * 0.5);
    else if (e.attackName === "swipe") armF = -10 * k;
    else lean = -4 * k;
  } else if (strike) {
    const k = clamp(t / e.cfg.active, 0, 1);
    if (e.attackName === "slam") { armUp = -16 * (1 - Math.sin(k * Math.PI * 0.5)); lean = 4 * k; }
    else { armF = 26 * Math.sin(k * Math.PI); lean = 5 * Math.sin(k * Math.PI); }
  } else if (charge) { lean = -6; armF = 10; }
  if (e.state === "dead") { ctx.translate(0, -6); ctx.rotate(0.5); ctx.globalAlpha = clamp(1 - e.deadTimer / 1.2, 0, 1); }

  const bob = (e.state === "approach") ? Math.abs(Math.sin(e.animClock * 9)) * 1.6 : 0;
  const up = -bob;
  const tx = lean * 0.5, ty = -54 + up, tw = 30, th = 27;
  const hy = -66 + up;

  // legs
  bossLeg(-9, P); bossLeg(7, P);

  // back fist
  bev(tx - 21, ty + 10 + armUp * 0.4, 8, 9, P.mSh, P.metal, "#0c0f15");

  // torso
  out(tx - 15, ty, tw, th, "#0c0f15");
  bev(tx - 15, ty, tw, th, P.metal, P.mHi, P.mSh);
  bev(tx - 12, ty + 3, 24, 16, P.trim, P.trimHi, P.trimSh);  // red chest armor
  pr(tx - 12, ty + 11, 24, 1, P.trimSh);
  const coreOn = enr ? (Math.sin(game.time * 22) > -0.3) : (Math.sin(game.time * 7) > -0.2);
  if (coreOn) {
    ctx.save(); ctx.globalAlpha *= 0.5; pr(tx - 8, ty + 5, 16, 12, enr ? "#ff5a4a" : P.eye); ctx.restore();
    pr(tx - 5, ty + 7, 10, 8, enr ? "#ff5a4a" : P.eye);
  }
  pr(tx - 15, ty + th - 3, tw, 3, P.dark);                   // waist
  pr(tx - 15, ty - 6, 3, 6, P.dark); pr(tx - 11, ty - 7, 3, 7, P.dark); // exhausts
  bossShoulder(tx - 24, ty - 2, P);
  bossShoulder(tx + 15, ty - 2, P);

  // head
  const hx = tx + lean * 0.3;
  out(hx - 9, hy, 19, 12, "#0c0f15");
  bev(hx - 9, hy, 19, 12, P.metal, P.mHi, P.mSh);
  pr(hx - 9, hy + 4, 19, 5, "#0c0f15");                      // visor slit
  const eyeC = enr ? "#ff3b30" : P.eye;
  ctx.save(); ctx.globalAlpha *= 0.5; pr(hx - 8, hy + 4, 16, 5, eyeC); ctx.restore();
  pr(hx - 7, hy + 5, 14, 3, windup ? "#ffffff" : eyeC);
  bev(hx - 12, hy - 4, 4, 6, P.trim, P.trimHi, P.trimSh);    // horns
  bev(hx + 8, hy - 4, 4, 6, P.trim, P.trimHi, P.trimSh);

  // front arm + big fist
  const ay = ty + 8 + armUp, fe = Math.max(0, armF);
  bev(tx + 13, ay, 8 + fe, 9, P.metal, P.mHi, P.mSh);
  const fx = tx + 13 + 8 + fe;
  out(fx - 2, ay - 2, 12, 13, "#0c0f15");
  bev(fx - 2, ay - 2, 12, 13, P.trim, P.trimHi, P.trimSh);
  pr(fx, ay + 1, 8, 2, P.trimSh); pr(fx, ay + 5, 8, 2, P.trimSh);

  if (e.hitFlash > 0) { ctx.save(); ctx.globalAlpha *= 0.6; ctx.fillStyle = "#fff"; ctx.fillRect(tx - 24, hy, 52, 72); ctx.restore(); }
  ctx.restore();

  if (windup) {
    ctx.fillStyle = Math.sin(game.time * 30) > 0 ? "#ff3b30" : "#ffd000";
    ctx.font = "bold 16px monospace";
    const label = e.attackName === "slam" ? "SLAM!" : e.attackName === "charge" ? "CHARGE!" : "!";
    ctx.fillText(label, px(sx) - ctx.measureText(label).width / 2, px(sy) - 78);
  }
}

/* ===================== Sewer boss (SLUDGE-9) ====================== */
function drawBoss2(e) {
  const sx = e.screenX, sy = e.z, f = e.facing, alt = e.alt || 0;
  drawShadow(sx, sy, 26);
  ctx.save();
  ctx.translate(px(sx), px(sy - alt));
  ctx.scale(f, 1);
  const P = e.pal, enr = e.enraged, t = e.stateTime;
  const windup = e.state === "windup", strike = e.state === "strike", charge = e.state === "charge";
  let armF = 0, armUp = 0, lean = 0;
  if (windup) {
    const k = clamp(t / (e.windDur || 0.5), 0, 1);
    if (e.attackName === "slam") armUp = -16 * Math.sin(k * Math.PI * 0.5);
    else if (e.attackName === "swipe") armF = -10 * k;
    else lean = -4 * k;
  } else if (strike) {
    const k = clamp(t / e.cfg.active, 0, 1);
    if (e.attackName === "slam") { armUp = -16 * (1 - Math.sin(k * Math.PI * 0.5)); lean = 4 * k; }
    else { armF = 26 * Math.sin(k * Math.PI); lean = 5 * Math.sin(k * Math.PI); }
  } else if (charge) { lean = -6; armF = 10; }
  if (e.state === "dead") { ctx.translate(0, -6); ctx.rotate(0.5); ctx.globalAlpha = clamp(1 - e.deadTimer / 1.2, 0, 1); }

  const bob = (e.state === "approach") ? Math.abs(Math.sin(e.animClock * 8)) * 1.8 : 0;
  const up = -bob, D = "#0a120a";
  const tx = lean * 0.5, ty = -50 + up, tw = 36, th = 26, hy = -58 + up;

  // squat legs
  bev(-16, -14, 13, 14, P.dark, P.metal, D); bev(3, -14, 13, 14, P.dark, P.metal, D);
  pr(-16, -3, 13, 3, D); pr(3, -3, 13, 3, D);
  // back claw
  bev(tx - 24, ty + 12 + armUp * 0.4, 9, 10, P.mSh, P.metal, D);
  // hunched bulbous torso
  out(tx - 18, ty, tw, th, D); bev(tx - 18, ty, tw, th, P.metal, P.mHi, P.mSh);
  bev(tx - 13, ty + 4, 26, 18, P.trim, P.trimHi, P.trimSh);   // toxic belly plate
  const coreOn = enr ? (Math.sin(game.time * 22) > -0.3) : (Math.sin(game.time * 7) > -0.2);
  if (coreOn) {
    ctx.save(); ctx.globalAlpha *= 0.55; pr(tx - 9, ty + 6, 18, 14, "#9bff3a"); ctx.restore();
    pr(tx - 6, ty + 8, 12, 10, enr ? "#ccff5a" : "#9bff3a");   // glowing green core
  }
  pr(tx - 13, ty + 13, 26, 1, P.trimSh);
  pr(tx - 18, ty + th - 3, tw, 3, P.dark);
  // pipe shoulders + vent stacks
  out(tx - 27, ty - 4, 11, 14, D); bev(tx - 27, ty - 4, 11, 14, P.metal, P.mHi, P.mSh);
  out(tx + 16, ty - 4, 11, 14, D); bev(tx + 16, ty - 4, 11, 14, P.metal, P.mHi, P.mSh);
  pr(tx - 24, ty - 7, 5, 4, P.dark); pr(tx + 19, ty - 7, 5, 4, P.dark);
  // ooze drips
  const drip = Math.floor(game.time * 3) % 3;
  pr(tx - 8, ty + th - 2 + drip * 2, 2, 4, "#7fdf3a");
  pr(tx + 6, ty + th - 2 + ((drip + 1) % 3) * 2, 2, 4, "#7fdf3a");
  // low domed head, single big eye
  const hx = tx + lean * 0.3;
  out(hx - 8, hy, 17, 11, D); bev(hx - 8, hy, 17, 11, P.metal, P.mHi, P.mSh);
  pr(hx - 8, hy + 4, 17, 5, D);
  const eyeC = enr ? "#ccff3a" : P.eye;
  ctx.save(); ctx.globalAlpha *= 0.5; pr(hx - 5, hy + 3, 11, 6, eyeC); ctx.restore();
  pr(hx - 3, hy + 4, 7, 4, windup ? "#ffffff" : eyeC);
  pr(hx, hy + 5, 2, 2, D);
  bev(hx - 10, hy - 4, 4, 6, P.trim, P.trimHi, P.trimSh);
  bev(hx + 7, hy - 4, 4, 6, P.trim, P.trimHi, P.trimSh);
  // front claw arm
  const ay = ty + 9 + armUp, fe = Math.max(0, armF);
  bev(tx + 15, ay, 9 + fe, 10, P.metal, P.mHi, P.mSh);
  const fx = tx + 15 + 9 + fe;
  out(fx - 2, ay - 3, 12, 15, D); bev(fx - 2, ay - 3, 12, 15, P.trim, P.trimHi, P.trimSh);
  pr(fx + 8, ay - 3, 3, 5, P.trimSh); pr(fx + 8, ay + 6, 3, 5, P.trimSh);

  if (e.hitFlash > 0) { ctx.save(); ctx.globalAlpha *= 0.6; ctx.fillStyle = "#fff"; ctx.fillRect(tx - 28, hy, 58, 70); ctx.restore(); }
  ctx.restore();
  if (windup) {
    ctx.fillStyle = Math.sin(game.time * 30) > 0 ? "#9bff3a" : "#ffd000";
    ctx.font = "bold 16px monospace";
    const label = e.attackName === "slam" ? "SLAM!" : e.attackName === "charge" ? "CHARGE!" : "!";
    ctx.fillText(label, px(sx) - ctx.measureText(label).width / 2, px(sy) - 76);
  }
}

/* ============================ Brute (big melee) ============================ */
function bruteLeg(cx, P) {
  bev(cx - 3, -20, 7, 13, P.dark, P.metal, "#0c0f15");
  pr(cx - 3, -14, 7, 2, P.mSh);
  out(cx - 4, -7, 9, 7, "#0c0f15");
  bev(cx - 4, -7, 9, 7, P.metal, P.mHi, P.mSh);
}
function drawBrute(e) {
  const sx = e.screenX, sy = e.z, f = e.facing, alt = e.alt || 0;
  drawShadow(sx, sy, 17);
  ctx.save();
  ctx.translate(px(sx), px(sy - alt));
  ctx.scale(f, 1);
  const P = e.pal, t = e.stateTime, lp = legPhase(e);
  const windup = e.state === "windup", strike = e.state === "strike";
  let armF = 0, lean = 0;
  if (windup) { const k = clamp(t / e.cfg.windup, 0, 1); armF = -12 * Math.sin(k * Math.PI * 0.5); lean = -3 * k; }
  else if (strike) { const k = clamp(t / e.cfg.active, 0, 1); armF = 22 * Math.sin(k * Math.PI); lean = 6 * Math.sin(k * Math.PI); }
  else if (e.state === "hurt") lean = 4;
  if (e.state === "dead") { ctx.translate(0, -8); ctx.rotate(1.0); ctx.globalAlpha = clamp(1 - e.deadTimer / 1.2, 0, 1); }
  const bob = (e.state === "approach") ? Math.abs(Math.sin(e.animClock * 9)) * 1.4 : 0;
  const up = -bob, tx = lean * 0.5, ty = -38 + up, tw = 26, th = 20, hy = -48 + up;

  bruteLeg(-8 - lp * 2, P); bruteLeg(8 + lp * 2, P);
  bev(tx - 20, ty + 8, 7, 9, P.mSh, P.metal, "#0c0f15");      // back fist
  out(tx - 13, ty, tw, th, "#0c0f15");
  bev(tx - 13, ty, tw, th, P.metal, P.mHi, P.mSh);            // big torso
  bev(tx - 10, ty + 2, 20, 8, P.trim, P.trimHi, P.trimSh);    // hazard chest plate
  pr(tx - 10, ty + 5, 20, 1, P.trimSh);
  for (let i = -8; i < 10; i += 4) pr(tx + i, ty + 12, 2, 4, P.dark); // grille
  // huge shoulders
  out(tx - 21, ty - 2, 9, 11, "#0c0f15"); bev(tx - 21, ty - 2, 9, 11, P.metal, P.mHi, P.mSh);
  out(tx + 12, ty - 2, 9, 11, "#0c0f15"); bev(tx + 12, ty - 2, 9, 11, P.metal, P.mHi, P.mSh);
  bev(tx - 21, ty - 2, 9, 3, P.trim, P.trimHi, P.trimSh);
  bev(tx + 12, ty - 2, 9, 3, P.trim, P.trimHi, P.trimSh);
  // small head sunk between shoulders
  const hx = tx + lean * 0.3;
  out(hx - 6, hy, 13, 9, "#0c0f15"); bev(hx - 6, hy, 13, 9, P.metal, P.mHi, P.mSh);
  pr(hx - 6, hy + 3, 13, 4, P.dark);
  pr(hx - 4, hy + 4, 11, 2, windup ? "#ffffff" : P.eye);
  // front arm + heavy fist
  const ay = ty + 7, fe = Math.max(0, armF);
  bev(tx + 11, ay, 8 + fe, 9, P.metal, P.mHi, P.mSh);
  const fx = tx + 11 + 8 + fe;
  out(fx - 2, ay - 2, 11, 12, "#0c0f15"); bev(fx - 2, ay - 2, 11, 12, P.trim, P.trimHi, P.trimSh);
  pr(fx, ay + 1, 7, 2, P.trimSh); pr(fx, ay + 5, 7, 2, P.trimSh);
  if (e.hitFlash > 0) { ctx.save(); ctx.globalAlpha *= 0.6; ctx.fillStyle = "#fff"; ctx.fillRect(tx - 22, hy, 46, 60); ctx.restore(); }
  ctx.restore();
  if (windup) { ctx.fillStyle = Math.sin(game.time * 26) > 0 ? "#ff3b30" : "#ffd000"; ctx.font = "bold 14px monospace"; ctx.fillText("!", px(sx) - 3, px(sy - alt) - 60); }
}

/* ============================ Laser gunner ============================ */
function drawLaser(e) {
  const sx = e.screenX, sy = e.z, f = e.facing, alt = e.alt || 0;
  drawShadow(sx, sy, 11);
  ctx.save();
  ctx.translate(px(sx), px(sy - alt));
  ctx.scale(f, 1);
  const P = e.pal, t = e.stateTime, lp = legPhase(e);
  const aiming = e.state === "aim";
  let lean = 0;
  if (aiming) lean = -2;
  else if (e.state === "hurt") lean = 5;
  if (e.state === "dead") { ctx.translate(0, -9); ctx.rotate(1.2); ctx.globalAlpha = clamp(1 - e.deadTimer / 1.2, 0, 1); }
  const bob = (e.state === "approach") ? Math.abs(Math.sin(e.animClock * 12)) * 1.2 : 0;
  const up = -bob, tx = lean * 0.5, ty = -25 + up, th = 11, hy = -33 + up;

  mechLeg(-3 - lp * 2, P); mechLeg(3 + lp * 2, P);
  bev(-8, ty + 2, 4, 7, P.mSh, P.metal, "#10131a");     // back arm
  out(tx - 6, ty, 13, th, "#10131a"); bev(tx - 6, ty, 13, th, P.metal, P.mHi, P.mSh);
  bev(tx - 4, ty + 2, 9, 5, P.trim, P.trimHi, P.trimSh); // chest core
  pr(tx - 7, ty + th - 2, 13, 2, P.dark);
  // head with sensor eye
  const hx = tx + lean * 0.3;
  out(hx - 5, hy, 11, 8, "#10131a"); bev(hx - 5, hy, 11, 8, P.metal, P.mHi, P.mSh);
  pr(hx - 5, hy + 3, 11, 4, P.dark);
  pr(hx + 0, hy + 4, 5, 2, P.eye);
  pr(hx - 1, hy - 3, 2, 3, P.dark); pr(hx - 2, hy - 5, 4, 2, P.eye);
  // big cannon arm
  const ay = ty + 2;
  bev(4, ay + 1, 6, 6, P.metal, P.mHi, P.mSh);          // shoulder mount
  out(9, ay, 13, 8, "#10131a"); bev(9, ay, 13, 8, P.dark, P.metal, "#10131a"); // barrel body
  bev(20, ay + 1, 6, 6, P.mSh, P.metal, "#10131a");     // muzzle ring
  pr(25, ay + 2, 2, 4, "#10131a");                       // bore
  // charge glow at muzzle while aiming
  if (aiming) {
    const r = 2 + Math.sin(t * 40) * 1.5 + (t / e.cfg.aim) * 3;
    ctx.save(); ctx.globalAlpha *= 0.85; ctx.fillStyle = P.eye;
    ctx.fillRect(px(26), px(ay + 1), px(2 + r), px(6)); ctx.restore();
  }
  if (e.hitFlash > 0) { ctx.save(); ctx.globalAlpha *= 0.7; ctx.fillStyle = "#fff"; ctx.fillRect(-9, hy, 18, 40); ctx.restore(); }
  ctx.restore();
}

/* ============================ Flyer ============================ */
function drawFlyer(e) {
  const sx = e.screenX, sy = e.z, f = e.facing, alt = e.alt || 0;
  drawShadow(sx, sy, 10 * (1 - Math.min(alt, 60) / 110));
  ctx.save();
  ctx.translate(px(sx), px(sy - alt));
  ctx.scale(f, 1);
  const P = e.pal, t = e.stateTime;
  const windup = e.state === "windup", strike = e.state === "strike";
  let lean = 0;
  if (strike) lean = 6;
  else if (windup) lean = -4;
  else if (e.state === "hurt") lean = 5;
  if (e.state === "dead") { ctx.rotate(1.4); ctx.globalAlpha = clamp(1 - e.deadTimer / 1.2, 0, 1); }
  const tx = lean * 0.5, by = -16;   // body sits a little above the (lifted) origin

  // hover thruster glow underneath
  ctx.save(); ctx.globalAlpha *= 0.45 + Math.random() * 0.15;
  ctx.fillStyle = P.eye; ctx.fillRect(px(tx - 5), px(by + 12), px(10), px(3));
  ctx.restore();
  // wings / rotors
  const flap = Math.sin(game.time * 26) * 2;
  bev(tx - 16, by + 2 + flap, 9, 3, P.trim, P.trimHi, P.trimSh);
  bev(tx + 7, by + 2 - flap, 9, 3, P.trim, P.trimHi, P.trimSh);
  pr(tx - 16, by + 1 + flap, 9, 1, P.trimHi); pr(tx + 7, by + 1 - flap, 9, 1, P.trimHi);
  // body pod
  out(tx - 8, by, 16, 12, "#15102a"); bev(tx - 8, by, 16, 12, P.metal, P.mHi, P.mSh);
  bev(tx - 6, by + 8, 12, 3, P.dark, P.mSh, "#15102a");   // underside
  // single big eye
  const eyeOn = windup ? (Math.sin(game.time * 40) > 0) : true;
  ctx.save(); ctx.globalAlpha *= 0.5; pr(tx - 4, by + 3, 9, 6, P.eye); ctx.restore();
  pr(tx - 2, by + 4, 6, 4, windup ? "#ffffff" : P.eye);
  pr(tx + 1, by + 5, 2, 2, "#15102a");                     // pupil
  // claws (drop when striking)
  const cl = strike ? 5 : 1;
  bev(tx - 5, by + 11, 3, 3 + cl, P.mSh, P.metal, "#15102a");
  bev(tx + 2, by + 11, 3, 3 + cl, P.mSh, P.metal, "#15102a");
  if (e.hitFlash > 0) { ctx.save(); ctx.globalAlpha *= 0.7; ctx.fillStyle = "#fff"; ctx.fillRect(tx - 16, by - 2, 32, 22); ctx.restore(); }
  ctx.restore();
  if (windup) { ctx.fillStyle = Math.sin(game.time * 30) > 0 ? "#ff3b30" : "#ffd000"; ctx.font = "bold 12px monospace"; ctx.fillText("!", px(sx) - 3, px(sy - alt) - 26); }
}

function drawProjectiles() {
  for (const pr of game.projectiles) {
    const x = px(pr.worldX - game.cameraX), y = px(pr.z - pr.alt);
    const dir = sign(pr.vx);
    // glowing bolt with a bright core and a trailing tail
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = pr.color;
    ctx.fillRect(x - dir * 10, y - 1, 14, pr.h + 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pr.color; ctx.fillRect(x - pr.w / 2, y, pr.w, pr.h);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(x - 2, y + 1, 5, pr.h - 2);
  }
  ctx.globalAlpha = 1;
}

/* ----------------------------- Obstacles ---------------------------- */
function drawObstacle(o) {
  const sx = o.x - game.cameraX;
  if (sx < -40 || sx > CANVAS_W + 40) return;
  drawShadow(sx, o.z, o.halfW);
  ctx.save();
  ctx.translate(px(sx), px(o.z));
  if (o.type === "cone") {
    pr(-7, -3, 14, 3, "#2a1d0c");
    bev(-6, -4, 12, 2, "#e0722a", "#ff9a4a", "#a8511c");
    bev(-5, -9, 10, 5, "#ef7e2e", "#ff9a4a", "#b85b1c");
    pr(-5, -8, 10, 2, "#f7f2e6");
    bev(-3, -16, 6, 7, "#ef7e2e", "#ff9a4a", "#b85b1c");
    pr(-2, -17, 4, 2, "#c75f1f");
  } else if (o.type === "drum") {
    out(-9, -24, 18, 24, "#15100c");
    bev(-9, -24, 18, 24, "#b5402e", "#d96a55", "#7a261a");
    pr(-7, -25, 14, 2, "#caa24a");          // lid
    pr(-9, -18, 18, 2, "#7a261a"); pr(-9, -9, 18, 2, "#7a261a");   // bands
    pr(-2, -22, 2, 18, "#d9806e");           // highlight
  } else if (o.type === "crate") {
    out(-12, -22, 24, 22, "#241708");
    bev(-12, -22, 24, 22, "#a9742f", "#c79551", "#7a521f");
    pr(-12, -15, 24, 1, "#6f4a1c"); pr(-12, -8, 24, 1, "#6f4a1c");
    pr(-12, -22, 3, 3, "#5b4424"); pr(9, -22, 3, 3, "#5b4424");
    pr(-12, -3, 3, 3, "#5b4424"); pr(9, -3, 3, 3, "#5b4424");
  } else { // barrier (concrete jersey barrier)
    out(-19, -8, 38, 8, "#101216");
    bev(-19, -8, 38, 8, "#9aa0aa", "#bcc1c9", "#6f757f");
    out(-13, -18, 26, 11, "#101216");
    bev(-13, -18, 26, 11, "#a7adb6", "#c7ccd3", "#787e88");
    pr(-13, -14, 26, 2, "#e0a23a"); pr(-13, -11, 26, 1, "#6f757f");  // hazard stripe
  }
  ctx.restore();
}

/* ----------------------------- Pizza pickup ------------------------- */
function drawPickup(pk) {
  const sx = pk.worldX - game.cameraX;
  drawShadow(sx, pk.z, 9);
  const bob = Math.sin(pk.bobT * 5) * 2.5;
  ctx.save();
  ctx.translate(px(sx), px(pk.z - 12 - bob));
  // glow
  ctx.globalAlpha = 0.22 + Math.sin(pk.bobT * 6) * 0.1; ctx.fillStyle = "#ffe27b";
  ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  // pie
  ctx.fillStyle = "#caa24a"; ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();   // crust
  ctx.fillStyle = "#f2cf63"; ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();   // cheese
  ctx.fillStyle = "#c4351f";
  [[-3, -2], [3, -1], [-1, 3], [4, 3]].forEach(([dx, dy]) => { ctx.beginPath(); ctx.arc(dx, dy, 1.6, 0, Math.PI * 2); ctx.fill(); });
  ctx.fillStyle = "#fff7e0"; ctx.fillRect(-4, -5, 2, 2);   // shine
  ctx.restore();
}

function drawActors() {
  const heroes = game.players.filter((pl) => !pl.out);
  const list = [...heroes, ...game.enemies, ...game.obstacles, ...game.pickups];
  list.sort((a, b) => a.z - b.z);
  for (const a of list) {
    if (a instanceof Player) drawHero(a);
    else if (a.obstacle) drawObstacle(a);
    else if (a.pickup) drawPickup(a);
    else if (a.isBoss) (a.kind === "ooze" ? drawBoss2 : drawBoss)(a);
    else if (a.kind === "brute") drawBrute(a);
    else if (a.kind === "laser") drawLaser(a);
    else if (a.kind === "flyer") drawFlyer(a);
    else drawDrone(a);
  }
}

function drawParticles() {
  for (const p of game.particles) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(px(p.x - game.cameraX), px(p.z), p.size, p.size);
  }
  ctx.globalAlpha = 1;
  ctx.font = "bold 11px monospace";
  for (const t of game.texts) {
    ctx.globalAlpha = clamp(t.life / t.max, 0, 1);
    const x = px(t.x - game.cameraX), y = px(t.z);
    ctx.fillStyle = "#000"; ctx.fillText(t.text, x + 1 - ctx.measureText(t.text).width/2, y + 1);
    ctx.fillStyle = t.color; ctx.fillText(t.text, x - ctx.measureText(t.text).width/2, y);
  }
  ctx.globalAlpha = 1;
}

/* --------------------------- HUD & overlays -------------------------- */
function drawPortrait(x, y, pal) {
  pal = pal || CHARACTERS[0].pal;
  ctx.fillStyle = "#0a0d14"; ctx.fillRect(x, y, 40, 40);
  ctx.fillStyle = "#1d2740"; ctx.fillRect(x + 2, y + 2, 36, 36);
  ctx.fillStyle = pal.sk;  ctx.fillRect(x + 8, y + 10, 24, 26);   // face
  ctx.fillStyle = pal.skS; ctx.fillRect(x + 8, y + 32, 24, 4);
  ctx.fillStyle = pal.bd;  ctx.fillRect(x + 6, y + 6, 28, 8);     // bandana
  ctx.fillStyle = pal.bdS; ctx.fillRect(x + 6, y + 12, 28, 3);
  ctx.fillStyle = pal.eye; ctx.fillRect(x + 12, y + 17, 6, 4); ctx.fillRect(x + 22, y + 17, 6, 4);
  ctx.fillStyle = pal.pp;  ctx.fillRect(x + 14, y + 18, 2, 2); ctx.fillRect(x + 24, y + 18, 2, 2);
  ctx.fillStyle = pal.skS; ctx.fillRect(x + 14, y + 28, 12, 3);   // mouth
}

function bar(x, y, w, h, pct, fg, bg) {
  ctx.fillStyle = "#000"; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fg; ctx.fillRect(x, y, px(w * clamp(pct, 0, 1)), h);
}

// one player's status block; side -1 = anchored left, +1 = anchored right
function drawPlayerPanel(p, side) {
  const pad = 10;
  const portX = side < 0 ? pad : CANVAS_W - pad - 40;
  const py0 = HUD_Y + 16;
  const tag = "P" + (p.playerIndex + 1);

  if (p.out) ctx.globalAlpha = 0.4;
  drawPortrait(portX, py0, p.pal);
  // tag chip on portrait
  ctx.fillStyle = P_TAGCOLOR[p.playerIndex] || "#fff";
  ctx.font = "bold 9px monospace"; ctx.textAlign = side < 0 ? "left" : "right";
  ctx.fillText(tag, side < 0 ? portX : portX + 40, py0 - 4);

  const barX = side < 0 ? portX + 46 : portX - 46 - 120;
  ctx.textAlign = "left";
  ctx.font = "bold 11px monospace"; ctx.fillStyle = "#fff";
  ctx.fillText(p.name, barX, py0 + 6);
  // health
  bar(barX, py0 + 12, 120, 9, p.hp / p.maxHp, "#36d35a", "#3a1414");
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  for (let i = 1; i < 10; i++) ctx.fillRect(barX + i * 12, py0 + 12, 1, 9);
  // special
  const ready = p.special >= 40;
  bar(barX, py0 + 25, 120, 5, p.special / p.maxSpecial, ready ? "#ffe23a" : "#c9a01f", "#2a2410");
  // lives + score
  ctx.font = "bold 9px monospace"; ctx.fillStyle = "#9fb0c8";
  ctx.fillText("x" + Math.max(0, p.lives) + (ready ? "   SPECIAL!" : ""), barX, py0 + 40);
  ctx.font = "bold 15px monospace"; ctx.fillStyle = "#ffe23a";
  ctx.fillText(String(p.score).padStart(6, "0"), barX, py0 + 56);

  if (p.out) { ctx.fillStyle = "#ff5a5a"; ctx.font = "bold 10px monospace"; ctx.fillText("OUT", barX + 70, py0 + 40); }
  ctx.globalAlpha = 1;
}

function drawHUD() {
  ctx.fillStyle = "#0b0e16"; ctx.fillRect(0, HUD_Y, CANVAS_W, CANVAS_H - HUD_Y);
  ctx.fillStyle = "#c0392b"; ctx.fillRect(0, HUD_Y, CANVAS_W, 3);
  ctx.fillStyle = "#7a1f16"; ctx.fillRect(0, HUD_Y + 3, CANVAS_W, 1);

  const ps = game.players;
  drawPlayerPanel(ps[0], -1);
  if (ps.length > 1) {
    drawPlayerPanel(ps[1], 1);
  } else {
    // solo: stage logo on the right
    ctx.fillStyle = "#c0392b"; ctx.fillRect(CANVAS_W - 150, HUD_Y + 52, 136, 20);
    ctx.fillStyle = "#000"; ctx.fillRect(CANVAS_W - 150, HUD_Y + 70, 136, 2);
    ctx.font = "bold 10px monospace"; ctx.fillStyle = "#fff";
    ctx.fillText("PUNCH UNTIL DEATH", CANVAS_W - 145, HUD_Y + 66);
  }

  // boss bar
  if (game.boss && !game.boss.dead && game.warnTimer <= 0) {
    const b = game.boss;
    const bw = 300, bx = (CANVAS_W - bw) / 2, by = 14;
    ctx.font = "bold 11px monospace"; ctx.fillStyle = "#ff4d4d";
    ctx.textAlign = "center";
    ctx.fillText((b.cfg.name || "BOSS") + (b.enraged ? "  *OVERDRIVE*" : ""), CANVAS_W / 2, by - 2);
    ctx.textAlign = "left";
    bar(bx, by + 2, bw, 10, b.hp / b.maxHp, b.enraged ? "#ff3b30" : "#e0392b", "#240a08");
  }

  // combos (each living player, near them)
  for (const p of game.players) {
    if (p.out || p.combo < 2) continue;
    const cx = clamp(px(p.worldX - game.cameraX), 40, CANVAS_W - 40);
    ctx.font = "bold 14px monospace"; ctx.textAlign = "center";
    ctx.fillStyle = "#000"; ctx.fillText(p.combo + " HITS", cx + 1, 52 + 1);
    ctx.fillStyle = p.combo >= 8 ? "#ff5ad6" : "#ffe23a";
    ctx.fillText(p.combo + " HITS", cx, 52);
    ctx.textAlign = "left";
  }
}

function drawCenterText(big, small, color) {
  ctx.textAlign = "center";
  ctx.font = "bold 34px monospace";
  ctx.fillStyle = "#000"; ctx.fillText(big, CANVAS_W/2 + 2, PLAY_H/2 + 2);
  ctx.fillStyle = color; ctx.fillText(big, CANVAS_W/2, PLAY_H/2);
  if (small) {
    ctx.font = "bold 12px monospace";
    ctx.fillStyle = "#dfe6f2";
    ctx.fillText(small, CANVAS_W/2, PLAY_H/2 + 28);
  }
  ctx.textAlign = "left";
}

function drawGoArrow() {
  if (game.goTimer <= 0) return;
  const blink = Math.sin(game.time * 12) > -0.3;
  if (!blink) return;
  const x = CANVAS_W - 70, y = 60;
  ctx.fillStyle = "#ffe23a";
  ctx.font = "bold 22px monospace";
  ctx.fillText("GO!", x, y);
  ctx.beginPath();
  ctx.moveTo(x + 44, y - 8); ctx.lineTo(x + 64, y - 14); ctx.lineTo(x + 44, y - 20);
  ctx.closePath(); ctx.fill();
}

function drawTitle() {
  // animated bg
  drawBackground();
  ctx.fillStyle = "rgba(0,0,20,0.45)"; ctx.fillRect(0, 0, CANVAS_W, PLAY_H);
  ctx.textAlign = "center";
  const bob = Math.sin(game.titlePulse * 2) * 3;
  ctx.font = "bold 40px monospace";
  ctx.fillStyle = "#000"; ctx.fillText("PUNCH UNTIL DEATH", CANVAS_W/2 + 3, 66 + bob + 3);
  ctx.fillStyle = "#ffe23a"; ctx.fillText("PUNCH UNTIL DEATH", CANVAS_W/2, 66 + bob);
  ctx.fillStyle = "#36d35a"; ctx.font = "bold 14px monospace";
  ctx.fillText("STAGE 1  —  BRIDGE OF STEEL", CANVAS_W/2, 92 + bob);

  ctx.font = "bold 11px monospace"; ctx.fillStyle = "#cfd6e4";
  const padCount = Pads.connected().length;
  const lines = [
    "1 or 2 PLAYER CO-OP",
    padCount > 0 ? (padCount + " controller" + (padCount > 1 ? "s" : "") + " detected — keyboard also works")
                 : "plug in a controller, or use the keyboard",
    "KB: WASD/Arrows move · J K L · Space jump · Shift block",
  ];
  lines.forEach((l, i) => ctx.fillText(l, CANVAS_W/2, 132 + i * 18));

  if (Math.sin(game.titlePulse * 5) > -0.2) {
    ctx.font = "bold 16px monospace"; ctx.fillStyle = "#fff";
    ctx.fillText("PRESS START / ENTER", CANVAS_W/2, 210);
  }
  ctx.textAlign = "left";
  // footer strip
  ctx.fillStyle = "#0b0e16"; ctx.fillRect(0, HUD_Y, CANVAS_W, CANVAS_H - HUD_Y);
  ctx.fillStyle = "#c0392b"; ctx.fillRect(0, HUD_Y, CANVAS_W, 3);
  ctx.textAlign = "center"; ctx.font = "bold 9px monospace"; ctx.fillStyle = "#6b7794";
  ctx.fillText("an original 8-bit-style brawler · P pause · M mute", CANVAS_W / 2, HUD_Y + 44);
  ctx.textAlign = "left";
}

/* --------------------------- Character select ----------------------- */
function drawSelectHeroPreview(cx, cyFeet, pal, anim) {
  // reuse the in-game hero drawing via a tiny fake player
  const fake = { screenX: cx + game.cameraX, z: cyFeet, worldX: cx + game.cameraX, facing: 1,
    state: "idle", stateTime: 0, invuln: 0, hitFlash: 0, animClock: anim, alt: 0, pal, playerIndex: -1 };
  drawHero(fake);
}
function drawSelect() {
  drawBackground();
  ctx.fillStyle = "rgba(0,0,20,0.55)"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.textAlign = "center";
  ctx.font = "bold 22px monospace"; ctx.fillStyle = "#ffe23a";
  ctx.fillText("CHOOSE YOUR FIGHTER", CANVAS_W / 2, 34);

  const n = CHARACTERS.length;
  const slotW = 96, totalW = n * slotW, x0 = (CANVAS_W - totalW) / 2 + slotW / 2;
  const feetY = 150;
  const sel = game.sel;
  for (let i = 0; i < n; i++) {
    const cx = x0 + i * slotW;
    // platform
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(cx - 36, 60, 72, 100);
    ctx.strokeStyle = "#33405c"; ctx.lineWidth = 2; ctx.strokeRect(cx - 36, 60, 72, 100);
    drawSelectHeroPreview(cx, feetY, CHARACTERS[i].pal, game.time * 6);
    ctx.font = "bold 12px monospace"; ctx.fillStyle = "#fff";
    ctx.fillText(CHARACTERS[i].name, cx, 178);
  }
  // cursor boxes with a small P# tag
  const cursorFor = (slot, idx) => {
    const color = P_TAGCOLOR[idx];
    const cx = x0 + slot.charIndex * slotW;
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.strokeRect(cx - 38, 58, 76, 104);
    ctx.fillStyle = color; ctx.font = "bold 11px monospace"; ctx.textAlign = "center";
    ctx.fillText("P" + (idx + 1), cx, 54);
  };
  cursorFor(sel.slots[0], 0);
  if (sel.slots[1].joined) cursorFor(sel.slots[1], 1);
  // device labels in the top corners (out of the way of the title)
  ctx.font = "bold 10px monospace";
  ctx.textAlign = "left";  ctx.fillStyle = P_TAGCOLOR[0];
  ctx.fillText("P1 " + sel.slots[0].input.label(), 12, 20);
  if (sel.slots[1].joined) { ctx.textAlign = "right"; ctx.fillStyle = P_TAGCOLOR[1]; ctx.fillText("P2 " + sel.slots[1].input.label(), CANVAS_W - 12, 20); }
  ctx.textAlign = "center";

  // prompts
  ctx.font = "bold 10px monospace"; ctx.fillStyle = "#cfd6e4";
  ctx.fillText("◄ ► choose      START / ENTER  begin      ESC  back", CANVAS_W / 2, 196);
  if (!sel.slots[1].joined) {
    const pads = Pads.connected();
    const p1Pad = (sel.slots[0].device && sel.slots[0].device.type === "pad") ? sel.slots[0].device.index : -1;
    const freePad = pads.some((i) => i !== p1Pad);
    const how = freePad ? "press any button on a 2nd controller" : "press  /  (slash) on the keyboard";
    if (Math.sin(game.titlePulse * 4) > -0.3) {
      ctx.fillStyle = P_TAGCOLOR[1];
      ctx.fillText("PLAYER 2 — " + how + " to join", CANVAS_W / 2, 214);
    }
  } else {
    ctx.fillStyle = "#36d35a";
    ctx.fillText("PLAYER 2 READY", CANVAS_W / 2, 214);
  }
  ctx.textAlign = "left";
}

/* ============================== Loop =============================== */
function render() {
  ctx.save();
  if (game.shakeTime > 0 && game.state === "playing") {
    const m = game.shakeMag * (game.shakeTime > 0 ? 1 : 0);
    ctx.translate((Math.random()-0.5)*m, (Math.random()-0.5)*m);
  }

  if (game.state === "title") {
    drawTitle();
    ctx.restore();
    return;
  }
  if (game.state === "select") {
    drawSelect();
    ctx.restore();
    return;
  }

  drawBackground();
  drawActors();
  drawProjectiles();
  drawParticles();
  // clip particles/actors that fall into HUD region (clean edge)
  ctx.fillStyle = "#0b0e16"; ctx.fillRect(0, PLAY_H, CANVAS_W, 0);
  drawHUD();
  drawGoArrow();

  if (game.warnTimer > 0 && Math.sin(game.time * 12) > -0.2) {
    const bn = (game.boss && game.boss.cfg.name) || (game.stage && game.stage.rooms[game.stage.rooms.length - 1] && KINDS[game.stage.rooms[game.stage.rooms.length - 1].spawns[0]].name) || "BOSS";
    drawCenterText("WARNING", bn + " APPROACHES", "#ff4d4d");
  }

  if (game.state === "paused") {
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, CANVAS_W, PLAY_H);
    drawCenterText("PAUSED", "press P to resume", "#ffffff");
  } else if (game.state === "gameover") {
    ctx.fillStyle = "rgba(40,0,0,0.6)"; ctx.fillRect(0, 0, CANVAS_W, PLAY_H);
    drawCenterText("GAME OVER", "START / ENTER to retry", "#ff4d4d");
  } else if (game.state === "stageclear") {
    ctx.fillStyle = "rgba(0,15,8,0.62)"; ctx.fillRect(0, 0, CANVAS_W, PLAY_H);
    const next = STAGES[game.stageIndex + 1];
    drawCenterText("STAGE " + (game.stageIndex + 1) + " CLEAR!",
      "NEXT — STAGE " + (game.stageIndex + 2) + ": " + (next ? next.name : ""), "#36d35a");
  } else if (game.state === "win") {
    ctx.fillStyle = "rgba(0,20,40,0.55)"; ctx.fillRect(0, 0, CANVAS_W, PLAY_H);
    const scoreLine = game.players.length > 1
      ? game.players.map((p) => "P" + (p.playerIndex + 1) + " " + p.score).join("   ")
      : "Score " + game.players[0].score;
    drawCenterText("GAME COMPLETE!", scoreLine + "  ·  START for title", "#ffe23a");
  }

  ctx.restore();
}

let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000; last = now;
  dt = Math.min(dt, 1 / 30);

  // poll all input devices once per frame
  Pads.poll();
  inputs[0].poll();
  inputs[1].poll();
  Menu.poll();

  // global state transitions
  if (game.state === "title") {
    if (Menu.jp("start")) game.beginSelect();
  } else if (game.state === "select") {
    game.updateSelect(dt);
  } else if (game.state === "stageclear") {
    game.stageClearTimer += dt; game.time += dt;
    if (game.shakeTime > 0) game.shakeTime -= dt;
    if (game.stageClearTimer > 3.6 || Menu.jp("start")) game.advanceStage();
  } else if (game.state === "gameover" || game.state === "win") {
    if (Menu.jp("start")) { if (game.state === "win") { game.state = "title"; game.theme = "bridge"; game.titlePulse = 0; } else game.restart(); }
    if (Menu.jp("back")) { game.state = "title"; game.theme = "bridge"; game.titlePulse = 0; }
    game.time += dt; if (game.shakeTime > 0) game.shakeTime -= dt;
  } else { // playing | paused
    if (Menu.jp("pause")) game.state = game.state === "paused" ? "playing" : "paused";
    if (Menu.jp("mute")) { Sound.muted = !Sound.muted; spawnText(game.cameraX + CANVAS_W / 2, 60, Sound.muted ? "MUTED" : "SOUND ON", "#fff"); }
  }

  if (game.state === "playing") game.update(dt);
  else if (game.state === "paused") { game.time += dt; if (game.shakeTime > 0) game.shakeTime -= dt; }

  render();
  requestAnimationFrame(frame);
}

/* ----------------------------- Boot ----------------------------- */
function resize() {
  const scale = Math.max(1, Math.floor(Math.min(
    (window.innerWidth - 30) / CANVAS_W,
    (window.innerHeight - 90) / CANVAS_H
  )));
  canvas.style.width = CANVAS_W * scale + "px";
  canvas.style.height = CANVAS_H * scale + "px";
}
window.addEventListener("resize", resize);

KB.init();
game.state = "title";
game.titlePulse = 0;
resize();
requestAnimationFrame(frame);
