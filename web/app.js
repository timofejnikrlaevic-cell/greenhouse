import * as THREE from 'three';

/* ==================== state & websocket ==================== */

const state = {
  temp: 24, hum: 45, pump: false, heater: 0,
  mode: 'normal', attack: false, alarm: false,
};

// local dev: direct WS port; production: same-origin /ws behind reverse proxy
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
const wsUrl = isLocal
  ? `ws://${location.hostname}:8765`
  : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const ws = new WebSocket(wsUrl);
ws.onmessage = (e) => onMessage(JSON.parse(e.data));
ws.onclose = () => addLog('⚠️ Соединение с сервером потеряно');
const send = (msg) => ws.send(JSON.stringify(msg));

function onMessage({ type, data }) {
  if (type === 'telemetry') {
    const wasHum = state.hum;
    Object.assign(state, {
      temp: data.temp, hum: data.humidity, pump: data.pump,
      heater: data.heater, mode: data.mode, alarm: data.alarm,
    });
    // auto-irrigation: turn pump on when soil dries out (once per drop below threshold)
    if (state.hum < 30 && !state.pump && !autoIrrigating) {
      autoIrrigating = true;
      send({ type: 'command', action: 'pump', value: true });
      addLog('🤖 Автополив: почва сухая — включаю полив');
    }
    if (state.hum > 55 && autoIrrigating) {
      autoIrrigating = false;
      send({ type: 'command', action: 'pump', value: false });
      addLog('🤖 Автополив: влажность в норме — выключаю полив');
    }
    void wasHum;
    pushChart(state.temp);
  } else if (type === 'security') {
    if (data.event === 'injection') {
      showHackerTip(data.action);
    } else if (data.event === 'rejected') {
      rejectedCount += 1;
      journal.push({ time: now(), event: 'отклонено', detail: data.reason });
      addLog(`⛔ Отклонено: ${data.reason}`);
    } else {
      acceptedCount += 1;
      journal.push({ time: now(), event: 'принято', detail: 'подпись верна' });
      addLog('✅ Команда принята — подпись верна');
    }
    drawBars();
  } else if (type === 'attack') {
    state.attack = data.on;
    addLog(data.on ? '⚠️ Атака запущена' : 'Атака остановлена');
  } else if (type === 'mode') {
    state.mode = data.mode;
    addLog(data.mode === 'defended' ? '🛡 Режим защиты включён' : 'Режим защиты выключен');
  }
  updateUI();
}

/* ==================== UI ==================== */

const $ = (id) => document.getElementById(id);

const STATUS_INFO = {
  ok:   { icon: '✅', desc: 'Все системы работают штатно' },
  warn: { icon: '⚠️', desc: 'Хакер в сети — команды без подписи принимаются!' },
  bad:  { icon: '🚨', desc: 'Критический перегрев — урожай погибает' },
  safe: { icon: '🛡', desc: 'HMAC-защита активна — поддельные команды отклоняются' },
};

let rejectedCount = 0;
let acceptedCount = 0;
let autoIrrigating = false;
const journal = [];   // for CSV export
let autoTimer = null;

function currentStatus() {
  if (state.alarm) return ['АВАРИЯ', 'bad'];
  if (state.attack && state.mode === 'normal') return ['АТАКА', 'warn'];
  if (state.mode === 'defended') return ['ЗАЩИТА', 'safe'];
  return ['НОРМА', 'ok'];
}

function updateUI() {
  const [label, cls] = currentStatus();
  const info = STATUS_INFO[cls];
  $('status').textContent = label;
  $('status').className = `badge ${cls}`;
  $('banner-icon').textContent = info.icon;
  $('banner-title').textContent = label;
  $('banner-title').style.color = cls === 'ok' ? 'var(--accent)'
    : cls === 'warn' ? '#fb923c' : cls === 'bad' ? 'var(--danger)' : 'var(--safe)';
  $('banner-desc').textContent = info.desc;
  $('banner-stats').textContent = `Отклонено атак: ${rejectedCount}`;
  $('banner').className = `st-${cls}`;

  $('temp-val').textContent = `${state.temp.toFixed(1)}°C`;
  $('hum-val').textContent = `${state.hum.toFixed(0)}%`;
  $('temp-bar').style.width = `${Math.min(100, (state.temp / 70) * 100)}%`;
  $('temp-bar').style.background = state.alarm ? '#f87171' : '#fb923c';
  $('hum-bar').style.width = `${state.hum}%`;
  $('hum-bar').style.background = '#38bdf8';

  $('btn-attack').textContent = state.attack ? '■ Остановить атаку' : '▶ Запустить атаку';
  $('btn-attack').classList.toggle('active', state.attack);
  $('btn-defend').textContent = state.mode === 'defended' ? '🛡 Защита ВКЛ — выключить' : '🛡 Включить защиту';
  $('btn-defend').classList.toggle('active', state.mode === 'defended');
  $('btn-pump').textContent = state.pump ? '💧 Полив: ВКЛ' : '💧 Полив: ВЫКЛ';
  $('btn-pump').classList.toggle('on', state.pump);
  $('btn-heater').textContent = `🔥 Обогрев: ${state.heater}%`;
}

$('btn-attack').onclick = () => send({ type: 'attack', on: !state.attack });
function toggleCinema() {
  document.body.classList.toggle('cinematic');
}
addEventListener('keydown', (e) => {
  if (e.code === 'KeyH' && !e.repeat) toggleCinema();
});
$('btn-menu').onclick = () => document.body.classList.toggle('panel-open');
$('btn-defend').onclick = () => send({ type: 'mode', mode: state.mode === 'defended' ? 'normal' : 'defended' });
$('btn-pump').onclick = () => send({ type: 'command', action: 'pump', value: !state.pump });
$('btn-heater').onclick = () => send({ type: 'command', action: 'heater', value: state.heater >= 100 ? 0 : state.heater + 50 });

/* --- auto-demo: normal -> attack -> defend cycle --- */

const AUTO_STEPS = [
  { label: '🎬 Демо 1/3: Норма', run: () => { send({ type: 'attack', on: false }); send({ type: 'mode', mode: 'normal' }); } },
  { label: '🎬 Демо 2/3: Атака', run: () => send({ type: 'attack', on: true }) },
  { label: '🎬 Демо 3/3: Защита', run: () => { send({ type: 'mode', mode: 'defended' }); setTimeout(() => send({ type: 'attack', on: false }), 1000); } },
];
let autoStep = 0;

$('btn-auto').onclick = () => {
  if (autoTimer) {  // stop demo
    clearInterval(autoTimer);
    autoTimer = null;
    autoStep = 0;
    $('btn-auto').textContent = '🎬 Авто-демо';
    addLog('Авто-демо остановлено');
    return;
  }
  addLog('Авто-демо запущено: Норма → Атака → Защита, по 25 с');
  runAutoStep();
  autoTimer = setInterval(runAutoStep, 25000);
};

function runAutoStep() {
  const step = AUTO_STEPS[autoStep % AUTO_STEPS.length];
  step.run();
  $('btn-auto').textContent = step.label;
  autoStep += 1;
}

/* --- CSV journal export --- */

$('btn-csv').onclick = () => {
  const rows = [['время', 'событие', 'детали'],
    ...journal.map((r) => [r.time, r.event, r.detail])];
  const csv = '\uFEFF' + rows.map((r) => r.join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `greenhouse-journal-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

function now() { return new Date().toLocaleTimeString(); }

/* --- camera tour around the farm --- */

const TOUR_POINTS = [
  { pos: [14, 6, 22], look: [0, 1.5, 16] },   // greenhouse 1
  { pos: [14, 6, 6], look: [0, 1.5, 0] },     // greenhouse 2
  { pos: [14, 6, -10], look: [0, 1.5, -16] }, // greenhouse 3
  { pos: [-20, 10, 18], look: [-12, 6, 10] }, // water tower
  { pos: [-10, 8, -6], look: [-16, 6, -12] }, // windmill
  { pos: [0, 18, 34], look: [0, 0, 0] },      // overview
];
let tourActive = false, tourIdx = 0, tourT = 0;

$('btn-tour').onclick = () => {
  tourActive = !tourActive;
  $('btn-tour').textContent = tourActive ? '■ Остановить тур' : '🚁 Тур по ферме';
  $('btn-tour').classList.toggle('active', tourActive);
  if (tourActive) addLog('🚁 Тур по ферме запущен');
  else addLog('Тур остановлен');
};

function moveTour(dt) {
  if (!tourActive) return;
  const a = TOUR_POINTS[tourIdx];
  const b = TOUR_POINTS[(tourIdx + 1) % TOUR_POINTS.length];
  tourT += dt * 0.12;
  if (tourT >= 1) { tourT = 0; tourIdx = (tourIdx + 1) % TOUR_POINTS.length; }
  const e = tourT < 0.5 ? 2 * tourT * tourT : 1 - Math.pow(-2 * tourT + 2, 2) / 2;
  camera.position.lerpVectors(new THREE.Vector3(...a.pos), new THREE.Vector3(...b.pos), e);
  const lookAt = new THREE.Vector3(...a.look).lerp(new THREE.Vector3(...b.look), e);
  camera.lookAt(lookAt);
}

/* --- hacker injection tip --- */

let tipTimer = null;
function showHackerTip(action) {
  const tip = $('hacker-tip');
  tip.textContent = `🎭 Хакер внедряет команду: ${action === 'heater' ? 'обогрев 100%' : 'полив выкл'}!`;
  tip.classList.add('show');
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => tip.classList.remove('show'), 2200);
}

/* --- accepted/rejected bar chart --- */

function drawBars() {
  const canvas = $('bars');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const max = Math.max(acceptedCount, rejectedCount, 1);
  const bw = 42;
  const drawBar = (count, x, color, label) => {
    const h = (count / max) * (canvas.height - 34);
    ctx.fillStyle = color;
    ctx.fillRect(x, canvas.height - 18 - h, bw, h);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + bw / 2, canvas.height - 4);
    ctx.fillText(String(count), x + bw / 2, Math.max(12, canvas.height - 24 - h));
  };
  drawBar(acceptedCount, 66, '#4ade80', 'принято');
  drawBar(rejectedCount, 156, '#f87171', 'отклонено');
}

function addLog(text) {
  const li = document.createElement('li');
  li.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  const log = $('log');
  log.prepend(li);
  while (log.children.length > 30) log.lastChild.remove();
}

const history = [];
function pushChart(value) {
  history.push(value);
  if (history.length > 60) history.shift();
  const canvas = $('chart');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = state.alarm ? '#f87171' : '#4ade80';
  ctx.lineWidth = 2;
  ctx.beginPath();
  history.forEach((t, i) => {
    const x = (i / 59) * canvas.width;
    const y = canvas.height - (t / 70) * canvas.height;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/* ==================== 3D scene: FARM ==================== */

const SKY = {
  ok: new THREE.Color(0x87ceeb),
  warn: new THREE.Color(0xd9b98a),
  bad: new THREE.Color(0x9c7a70),
  safe: new THREE.Color(0x9fc2e8),
};
const BEACON = { ok: 0x22c55e, warn: 0xfb923c, bad: 0xef4444, safe: 0x60a5fa };

const scene = new THREE.Scene();
scene.background = SKY.ok.clone();
scene.fog = new THREE.Fog(scene.background, 60, 160);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 300);
camera.position.set(26, 14, 30);
camera.lookAt(0, 2, 0);

const isMobile = matchMedia('(max-width: 720px)').matches;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
renderer.shadowMap.enabled = true;
$('scene').appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x2c4a22, 0.95));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.2);
sun.position.set(30, 40, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -45;
sun.shadow.camera.right = sun.shadow.camera.top = 45;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);

/* --- materials --- */

const M = {
  metal: new THREE.MeshStandardMaterial({ color: 0x556274, metalness: 0.65, roughness: 0.35 }),
  film: new THREE.MeshPhongMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide }),
  soil: new THREE.MeshStandardMaterial({ color: 0x6b4a2f }),
  plant: new THREE.MeshStandardMaterial({ color: 0x3ecf5a }),
  dryPlant: new THREE.MeshStandardMaterial({ color: 0xa68b3c }),
  water: new THREE.MeshStandardMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.75 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x8a6238 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x9aa3ad }),
  red: new THREE.MeshStandardMaterial({ color: 0xd9534f }),
  white: new THREE.MeshStandardMaterial({ color: 0xf1f5f9 }),
  panel: new THREE.MeshStandardMaterial({ color: 0x1e3a5f, metalness: 0.5, roughness: 0.3 }),
};

function mesh(geo, mat, x, y, z, parent = scene) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

/* --- ground & paths --- */

const ground = mesh(new THREE.CylinderGeometry(70, 70, 1, 64), new THREE.MeshStandardMaterial({ color: 0x4c7a3a }), 0, -0.5, 0);
ground.castShadow = false;

for (const [x, z, w, d] of [[0, 26, 60, 3], [0, -26, 60, 3], [26, 0, 3, 55], [-26, 0, 3, 55]]) {
  const path = mesh(new THREE.BoxGeometry(w, 0.08, d), M.stone, x, 0.04, z);
  path.castShadow = false;
}

/* --- three greenhouses --- */

const greenhouses = [];   // { group, drops[], plants[], lampMat, lampLight, beaconMat }
const GH_Z = [-16, 0, 16];

for (const z of GH_Z) {
  const g = new THREE.Group();
  g.position.set(0, 0, z);
  scene.add(g);

  // arch ribs + cover
  for (let x = -4.5; x <= 4.5; x += 1.5) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(3, 0.06, 8, 24, Math.PI), M.metal);
    rib.rotation.y = Math.PI / 2;
    rib.position.set(x, 0, 0);
    g.add(rib);
  }
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 10), M.metal);
  ridge.rotation.z = Math.PI / 2;
  ridge.position.y = 3;
  g.add(ridge);
  const cover = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 3, 10.4, 24, 1, true, 0, Math.PI), M.film);
  cover.rotation.z = Math.PI / 2;
  g.add(cover);

  // beds + drip tubes + plants
  const drops = [];
  const plants = [];
  for (const bz of [-1.6, 0, 1.6]) {
    mesh(new THREE.BoxGeometry(9, 0.3, 1.1), M.soil, 0, 0.15, bz, g);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 9), M.metal);
    tube.rotation.z = Math.PI / 2;
    tube.position.set(0, 0.55, bz);
    g.add(tube);
    for (let i = 0; i < 14; i++) {
      const p = mesh(new THREE.SphereGeometry(0.17, 10, 8), M.plant, -4 + i * 0.6, 0.45, bz, g);
      plants.push(p);
    }
    for (let i = 0; i < 24; i++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0x60a5fa }));
      d.position.set((Math.random() - 0.5) * 8.6, 0.25 + Math.random() * 0.35, bz + (Math.random() - 0.5) * 0.5);
      d.visible = false;
      g.add(d);
      drops.push(d);
    }
  }

  // heater lamp + light
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0xff5533, emissiveIntensity: 0.1 });
  mesh(new THREE.SphereGeometry(0.25, 12, 10), lampMat, 0, 2.1, 0, g);
  const lampLight = new THREE.PointLight(0xff6633, 0, 14);
  lampLight.position.set(0, 2.1, 0);
  g.add(lampLight);

  // status beacon on a pole
  const beaconMat = new THREE.MeshStandardMaterial({ color: BEACON.ok, emissive: BEACON.ok, emissiveIntensity: 1.5 });
  mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2), M.metal, 5.6, 1.1, 0, g);
  mesh(new THREE.SphereGeometry(0.3, 16, 12), beaconMat, 5.6, 2.35, 0, g);

  greenhouses.push({ group: g, drops, plants, lampMat, lampLight, beaconMat, smoke: null });
}

/* --- water tower --- */

mesh(new THREE.CylinderGeometry(0.25, 0.35, 6, 10), M.wood, -12, 3, 10);
mesh(new THREE.SphereGeometry(2.2, 20, 14), M.white, -12, 7.6, 10);
const tankWater = mesh(new THREE.SphereGeometry(1.9, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), M.water, -12, 7.8, 10);
mesh(new THREE.CylinderGeometry(0.12, 0.12, 6.2), M.wood, -13.6, 3, 10.6);
mesh(new THREE.CylinderGeometry(0.12, 0.12, 6.2), M.wood, -10.4, 3, 9.4);

/* --- windmill (rotates with pump) --- */

const mill = new THREE.Group();
mill.position.set(-16, 0, -12);
scene.add(mill);
mesh(new THREE.CylinderGeometry(0.3, 0.55, 9, 8), M.white, 0, 4.5, 0, mill);
const blades = new THREE.Group();
blades.position.set(0, 9.1, 0.6);
mill.add(blades);
for (let i = 0; i < 4; i++) {
  const holder = new THREE.Group();
  holder.rotation.z = (i * Math.PI) / 2;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.6, 0.08), M.white);
  blade.position.y = 1.9;
  blade.castShadow = true;
  holder.add(blade);
  blades.add(holder);
}

/* --- solar panels --- */

for (const [x, z, ry] of [[12, -12, 0.4], [15.5, -10, 0.4]]) {
  const post = mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2), M.metal, x, 0.6, z);
  post.rotation.y = ry;
  const panel = mesh(new THREE.BoxGeometry(3.4, 0.08, 2.2), M.panel, x, 1.5, z);
  panel.rotation.set(-0.45, ry, 0);
}

/* --- fence & trees --- */

const fencePost = new THREE.BoxGeometry(0.12, 1.1, 0.12);
for (let i = -34; i <= 34; i += 4) {
  mesh(fencePost, M.wood, i, 0.55, 32);
  mesh(fencePost, M.wood, i, 0.55, -32);
  mesh(new THREE.BoxGeometry(4, 0.08, 0.06), M.wood, i + 2, 0.8, 32);
  mesh(new THREE.BoxGeometry(4, 0.08, 0.06), M.wood, i + 2, 0.8, -32);
}
const tree = (x, z, s = 1) => {
  mesh(new THREE.CylinderGeometry(0.25 * s, 0.35 * s, 2.4 * s, 8), M.wood, x, 1.2 * s, z);
  mesh(new THREE.SphereGeometry(1.5 * s, 10, 8), M.plant, x, 3 * s, z);
};
tree(-30, 22, 1.3); tree(-33, 18, 1); tree(30, 20, 1.2); tree(32, 15, 0.9);
tree(28, -22, 1.1); tree(-29, -20, 1.2);

/* --- forest around the farm --- */

const forest = new THREE.Group();
scene.add(forest);
const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.2, 7);
const crownGeo = new THREE.SphereGeometry(1.4, 9, 7);
const crownColors = [0x2e7d32, 0x388e3c, 0x43a047, 0x2f6f3e];
for (let i = 0; i < 90; i++) {
  const side = Math.random() < 0.5 ? -1 : 1;
  const x = side * (38 + Math.random() * 22);
  const z = (Math.random() - 0.5) * 110;
  const s = 0.8 + Math.random() * 1.1;
  const trunk = new THREE.Mesh(trunkGeo, M.wood);
  trunk.position.set(x, 1.1 * s, z);
  trunk.scale.setScalar(s);
  forest.add(trunk);
  const crown = new THREE.Mesh(crownGeo,
    new THREE.MeshStandardMaterial({ color: crownColors[i % crownColors.length] }));
  crown.position.set(x, 2.9 * s, z);
  crown.scale.setScalar(s * (0.85 + Math.random() * 0.4));
  forest.add(crown);
}
// back row behind the greenhouses
for (let i = 0; i < 40; i++) {
  const x = (Math.random() - 0.5) * 110;
  const z = -(38 + Math.random() * 22);
  const s = 0.8 + Math.random() * 1.1;
  const trunk = new THREE.Mesh(trunkGeo, M.wood);
  trunk.position.set(x, 1.1 * s, z);
  trunk.scale.setScalar(s);
  forest.add(trunk);
  const crown = new THREE.Mesh(crownGeo,
    new THREE.MeshStandardMaterial({ color: crownColors[i % crownColors.length] }));
  crown.position.set(x, 2.9 * s, z);
  crown.scale.setScalar(s * (0.85 + Math.random() * 0.4));
  forest.add(crown);
}

/* --- tractor driving around the farm --- */

const tractor = new THREE.Group();
scene.add(tractor);
mesh(new THREE.BoxGeometry(1.6, 0.7, 1), M.red, 0, 0.75, 0, tractor);
mesh(new THREE.BoxGeometry(0.8, 0.6, 0.9), M.white, -0.2, 1.35, 0, tractor);
const wheels = [];
for (const [wx, wz, r] of [[-0.55, 0.55, 0.35], [-0.55, -0.55, 0.35], [0.55, 0.6, 0.5], [0.55, -0.6, 0.5]]) {
  const wheel = mesh(new THREE.CylinderGeometry(r, r, 0.25, 12), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }), wx, r, wz, tractor);
  wheel.rotation.x = Math.PI / 2;
  wheels.push(wheel);
}
const TRACTOR_PATH = [
  new THREE.Vector3(8, 0, 24), new THREE.Vector3(8, 0, -24),
  new THREE.Vector3(-8, 0, -24), new THREE.Vector3(-8, 0, 24),
];
let tractorSeg = 0, tractorT = 0;
function moveTractor(dt) {
  const a = TRACTOR_PATH[tractorSeg], b = TRACTOR_PATH[(tractorSeg + 1) % 4];
  tractorT += dt * 0.06;
  if (tractorT >= 1) { tractorT = 0; tractorSeg = (tractorSeg + 1) % 4; }
  tractor.position.lerpVectors(a, b, tractorT);
  tractor.lookAt(b);
  for (const w of wheels) w.rotation.y += dt * 6;
}

/* --- clouds drifting in the sky --- */

const clouds = [];
for (let i = 0; i < 10; i++) {
  const cloud = new THREE.Group();
  const puffs = 3 + Math.floor(Math.random() * 3);
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, roughness: 1 });
  for (let j = 0; j < puffs; j++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(1.2 + Math.random() * 1.4, 10, 8), cloudMat);
    puff.position.set(j * 1.6 - puffs * 0.8, Math.random() * 0.6, Math.random() * 1.2);
    cloud.add(puff);
  }
  cloud.position.set((Math.random() - 0.5) * 100, 16 + Math.random() * 12, (Math.random() - 0.5) * 100);
  scene.add(cloud);
  clouds.push(cloud);
}

/* --- birds flying in circles --- */

const birds = [];
const birdMat = new THREE.MeshBasicMaterial({ color: 0x2b2b2b, side: THREE.DoubleSide });
for (let i = 0; i < 5; i++) {
  const bird = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.1, 3), birdMat);
  bird.rotation.x = Math.PI / 2;
  scene.add(bird);
  birds.push({ mesh: bird, radius: 18 + Math.random() * 14, speed: 0.25 + Math.random() * 0.2, phase: Math.random() * Math.PI * 2, y: 12 + Math.random() * 6 });
}

/* --- effect: smoke over alarming greenhouse --- */

const smokes = [];
for (const gh of greenhouses) {
  const puffs = [];
  for (let i = 0; i < 10; i++) {
    const puffMat = new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.6 });
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.35 + Math.random() * 0.3, 8, 6), puffMat);
    puff.visible = false;
    scene.add(puff);
    puffs.push(puff);
  }
  smokes.push(puffs);
}

/* --- effect: defence shield bubble --- */

const shield = new THREE.Mesh(
  new THREE.SphereGeometry(20, 32, 24),
  new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.12, side: THREE.DoubleSide }),
);
shield.position.y = 3;
shield.visible = false;
scene.add(shield);

/* --- fly camera (WASD + QE + mouse drag) --- */

const keys = {};
const look = { yaw: 0.72, pitch: 0.25 };
let dragging = false, lastX = 0, lastY = 0;

renderer.domElement.addEventListener('pointerdown', (e) => {
  document.body.classList.remove('panel-open');
  dragging = true; lastX = e.clientX; lastY = e.clientY;
});
addEventListener('pointerup', () => { dragging = false; });
addEventListener('pointermove', (e) => {
  if (!dragging) return;
  look.yaw -= (e.clientX - lastX) * 0.004;
  look.pitch = THREE.MathUtils.clamp(look.pitch + (e.clientY - lastY) * 0.004, -1.4, 1.4);
  lastX = e.clientX; lastY = e.clientY;
});
addEventListener('keydown', (e) => { keys[e.code] = true; });
addEventListener('keyup', (e) => { keys[e.code] = false; });

function moveCamera(dt) {
  const speed = (keys.ShiftLeft ? 30 : 14) * dt;
  const dir = new THREE.Vector3(
    Math.sin(look.yaw) * Math.cos(look.pitch),
    Math.sin(look.pitch),
    Math.cos(look.yaw) * Math.cos(look.pitch),
  ).negate();
  const right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  if (keys.KeyW || keys.ArrowUp) camera.position.addScaledVector(dir, speed);
  if (keys.KeyS || keys.ArrowDown) camera.position.addScaledVector(dir, -speed);
  if (keys.KeyA || keys.ArrowLeft) camera.position.addScaledVector(right, -speed);
  if (keys.KeyD || keys.ArrowRight) camera.position.addScaledVector(right, speed);
  if (keys.KeyE) camera.position.y += speed;
  if (keys.KeyQ) camera.position.y = Math.max(0.8, camera.position.y - speed);
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -60, 60);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -60, 60);
  camera.position.y = THREE.MathUtils.clamp(camera.position.y, 0.8, 45);

  camera.lookAt(
    camera.position.x + dir.x * 10,
    camera.position.y + dir.y * 10,
    camera.position.z + dir.z * 10,
  );
}

/* --- animation --- */

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  moveCamera(0.016);

  const [, cls] = currentStatus();
  const threat = state.attack && state.mode === 'normal';
  const defended = state.mode === 'defended';

  // per-greenhouse visuals
  greenhouses.forEach((gh, gi) => {
    // water drops
    gh.drops.forEach((d) => { d.visible = state.pump; });
    if (state.pump) {
      for (const d of gh.drops) {
        d.position.y -= 0.05;
        if (d.position.y < 0.2) {
          d.position.set((Math.random() - 0.5) * 8.6, 0.55, (Math.random() - 0.5) * 0.5);
        }
      }
    }

    // heater lamp
    gh.lampMat.emissiveIntensity = 0.1 + (state.heater / 100) * 2.5;
    gh.lampLight.intensity = (state.heater / 100) * 4;

    // plants grow with humidity, wilt when dry
    const grow = 0.5 + (state.hum / 100) * 0.9;
    const mat = state.hum < 30 ? M.dryPlant : M.plant;
    for (const p of gh.plants) {
      p.material = mat;
      p.scale.setScalar(THREE.MathUtils.lerp(p.scale.x, grow, 0.03));
      p.position.y = 0.45 + p.scale.x * 0.12;
    }

    // beacon
    gh.beaconMat.color.set(BEACON[cls]);
    gh.beaconMat.emissive.set(BEACON[cls]);
    gh.beaconMat.emissiveIntensity = 1.2 + Math.sin(t * 3) * (threat || state.alarm ? 0.9 : 0.2);
  });

  // smoke while overheated
  const smoking = state.temp > 45;
  smokes.forEach((puffs, gi) => {
    puffs.forEach((puff, i) => {
      puff.visible = smoking;
      if (!smoking) return;
      const phase = (t * 0.5 + i / puffs.length) % 1;
      puff.position.set(
        (Math.random() - 0.5) * 8,
        2 + phase * 6,
        GH_Z[gi] + (Math.random() - 0.5) * 1.5,
      );
      puff.material.opacity = 0.5 * (1 - phase);
      puff.scale.setScalar(0.6 + phase * 1.6);
    });
  });

  // shield bubble in defended mode
  shield.visible = defended;
  if (defended) {
    shield.material.opacity = 0.08 + Math.sin(t * 2) * 0.04;
    shield.rotation.y = t * 0.15;
  }

  // windmill spins when pump works, slowly otherwise
  blades.rotation.z += state.pump ? 0.12 : 0.01;

  moveTractor(0.016);
  moveTour(0.016);

  // clouds drift & birds circle
  for (const cloud of clouds) {
    cloud.position.x += 0.035;
    if (cloud.position.x > 60) cloud.position.x = -60;
  }
  for (const b of birds) {
    b.phase += b.speed * 0.016;
    b.mesh.position.set(Math.cos(b.phase) * b.radius, b.y + Math.sin(b.phase * 3) * 0.6, Math.sin(b.phase) * b.radius);
    b.mesh.rotation.z = Math.sin(t * 10 + b.phase) * 0.35;
    b.mesh.rotation.y = -b.phase;
  }

  // gentle day/night cycle of the sun
  const dayPhase = (Math.sin(t * 0.05) + 1) / 2;
  sun.intensity = 0.55 + dayPhase * 0.75;
  sun.color.setHSL(0.09, 0.55 - dayPhase * 0.35, 0.6 + dayPhase * 0.25);

  // water level in tower: full when pump on
  tankWater.scale.y = THREE.MathUtils.lerp(tankWater.scale.y, state.pump ? 1 : 0.45, 0.02);

  // sky mood
  scene.background.lerp(SKY[cls], 0.04);
  scene.fog.color.copy(scene.background);

  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

setTimeout(() => $('hint').classList.add('faded'), 9000);