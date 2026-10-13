// Hood Warfare — browser build. Three.js, no build step. Look recipe studied from Stillwater:
// ACES + pixel-budget DPR + HDR environment + warm/cool three-light rig + texel-snapped shadows + fog + light post.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { manager, loadHDR, loadGLB, setAniso } from './assets.js';
import { buildWorld, lamps, windowsLit, resolve, MAP } from './world.js';
import { Player } from './player.js';
import { FX, Weapon, GUN_SPECS } from './weapon.js';
import { Bot, buildNav, rayVsBots, freeCellNear } from './bots.js';
import { loadCharacters } from './characters.js';
import { Launcher } from './rocket.js';
import { addWall, wallSpec, initDestruction, updateDestruction, destruction, blast } from './destruction.js';
import { WALL_LOTS, GEO, houseDescs } from './world.js';
import { addHouse } from './destruction.js';
import { initHud, hud } from './hud.js';
import { renderLadder } from './ladder.js';
import { initInput, input, poll, requestLock, TOUCH } from './input.js';
import { unlockAudio, sfx, setListener, setMuted, isMuted } from './audio.js';

const qs = new URLSearchParams(location.search);
// weekly ladder (worker/): gamertag + optional wallet live in localStorage; results post at match end
const API = qs.get('api') || 'https://hood-warfare-api.eugenelau9696.workers.dev';
const ident = (() => { try { return JSON.parse(localStorage.getItem('hw.id') || '{}') || {}; } catch { return {}; } })();
function saveIdent() { ident.name = $('gname').value.trim(); ident.wallet = $('gwallet').value.trim(); try { localStorage.setItem('hw.id', JSON.stringify(ident)); } catch {} }
async function submitMatch() {
  const lm = $('lmsg'); if (qs.get('nosubmit') === '1') return;
  let me = null;
  if (!ident.name) lm.textContent = 'SET A GAMERTAG BELOW TO BE RANKED ON THE WEEKLY LADDER';
  else {
    lm.textContent = 'POSTING TO THE WEEKLY LADDER…';
    const body = { name: ident.name, wallet: ident.wallet || undefined, kills: player.kills, deaths: player.deaths, blue: score.blue, red: score.red, duration: Math.round(MATCH.time - MATCH.left) };
    try {
      const r = await fetch(API + '/api/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(9000) });
      const j = await r.json();
      if (j.ok) { me = { name: ident.name, rank: j.rank, points: j.points }; lm.textContent = `WEEKLY LADDER · #${j.rank} OF ${j.total} · +${j.earned} PTS (${j.points} THIS WEEK)`; }
      else lm.textContent = 'LADDER: ' + (j.error || 'rejected').toUpperCase();
    } catch (e) { lm.textContent = 'LADDER: COULD NOT REACH THE SERVER'; return; }
  }
  try { const r = await fetch(API + '/api/ladder?limit=10', { signal: AbortSignal.timeout(9000) }); const d = await r.json(); if (d.ok) renderLadder($('lboard'), d, me); } catch {}
}
const Q = { mobile: TOUCH || qs.get('mobile') === '1', silent: qs.get('silent') === '1', fps: 0, houses: qs.get('houses') !== '0' };
const $ = (id) => document.getElementById(id);
const canvas = $('gl');

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
function dpr(w, h) { return Math.min(devicePixelRatio || 1, Q.mobile ? 1.6 : 2, Math.sqrt((Q.mobile ? 3.0e6 : 4.6e6) / (w * h))); }
renderer.setPixelRatio(dpr(innerWidth, innerHeight)); renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
setAniso(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2738);
scene.fog = new THREE.Fog(0x34435c, 18, 135);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.06, 420);
scene.add(camera);

// lights: cool dusk key from the sky, warm afterglow rim, cool hemisphere, then the street lamps
const key = new THREE.DirectionalLight(0xa8bce8, 2.6); key.position.set(-30, 60, 25); key.castShadow = true;
const SHADOW = Q.mobile ? 1536 : 2048; key.shadow.mapSize.set(SHADOW, SHADOW);
Object.assign(key.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 160 }); key.shadow.camera.updateProjectionMatrix();
key.shadow.normalBias = 0.05; key.shadow.bias = -0.00015; key.shadow.radius = 1.5;
scene.add(key); scene.add(key.target);
const rim = new THREE.DirectionalLight(0xffa06a, 0.35); rim.position.set(60, 14, -40); scene.add(rim);
const hemi = new THREE.HemisphereLight(0x6a86b8, 0x1d1a17, 0.62); scene.add(hemi);
const keyDir = key.position.clone().normalize();
// texel-snapped shadow frustum following the player (Stillwater's trick against shadow shimmer)
const _sv = new THREE.Vector3();
function snapShadow(p) {
  const texel = 68 / SHADOW; _sv.set(Math.round(p.x / texel) * texel, 0, Math.round(p.z / texel) * texel);
  key.target.position.copy(_sv); key.position.copy(_sv).addScaledVector(keyDir, 90);
}

// ---------- post ----------
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: Q.mobile ? 2 : 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), Q.mobile ? 0.28 : 0.34, 0.65, 0.88); composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, hurt: { value: 0 }, aspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, hurt, aspect; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5; float r2 = dot(d * vec2(aspect, 1.0), d * vec2(aspect, 1.0));
      vec3 c; c.r = texture2D(tDiffuse, vUv + d * 0.0022).r; c.g = texture2D(tDiffuse, vUv).g; c.b = texture2D(tDiffuse, vUv - d * 0.0022).b;
      c = c * vec3(0.96, 1.0, 1.07) + vec3(0.0, 0.004, 0.012);            // cool dusk grade
      float lum = dot(c, vec3(0.3, 0.59, 0.11)); c = mix(vec3(lum), c, 1.08); // a touch of saturation
      c *= mix(1.0, smoothstep(1.1, 0.25, r2), 0.6);                       // vignette
      c += (hash(vUv * vec2(1920.0, 1080.0) + fract(time)) - 0.5) * 0.028;  // grain
      c = mix(c, vec3(lum * 1.4, lum * 0.25, lum * 0.2) + c * 0.25, clamp(hurt, 0.0, 1.0) * 0.7 * smoothstep(0.1, 0.9, r2 + 0.3));
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(grade); composer.addPass(new OutputPass());
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setPixelRatio(dpr(w, h)); renderer.setSize(w, h); composer.setSize(w, h); bloom.setSize(w / 2, h / 2);
  camera.aspect = w / h; camera.updateProjectionMatrix(); grade.uniforms.aspect.value = w / h;
  // portrait phones: keep a sane horizontal field of view instead of a tunnel
  weapon.baseFov = w < h ? THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(33)) / (w / h))), 72, 98) : 72;
  weapon.portrait = w < h;
}
addEventListener('resize', resize);
setTimeout(resize, 0);

// ---------- game state ----------
const player = new Player(camera);
const fx = new FX(scene);
const weapon = new Weapon(scene, camera, player, fx);
// the arsenal: AK (also the bots' third-person gun), MAC-10, MP5, M700 sniper, plus the RPG-7 launcher
const guns = { ak: weapon, mac10: new Weapon(scene, camera, player, fx, GUN_SPECS.mac10), mp5: new Weapon(scene, camera, player, fx, GUN_SPECS.mp5), m700: new Weapon(scene, camera, player, fx, GUN_SPECS.m700) };
const ORDER = ['ak', 'mac10', 'mp5', 'm700', 'rpg'];
const curGun = () => guns[arsenal.cur] || null;
const launcher = new Launcher(scene, camera, player, fx);
const arsenal = { cur: 'ak', switchT: 0 };
const bots = []; let trooper = null;
const score = { red: 0, blue: 0 }; const MATCH = { limit: 100, time: 600, left: 600, over: false, started: false };
const ab = { 4: { need: 3, have: 0, name: 'SNITCH', sub: 'PRESS [4]' }, 5: { need: 5, have: 0, name: 'HOMIES', sub: 'PRESS [5]' }, 6: { need: 4, have: 0, name: 'SUICIDE BOMBER', sub: 'PRESS [6]' } };
let snitchUntil = 0, killStreak = 0, streakT = 0, time = 0, hurtK = 0, respawnAt = 0;
const ghostMat = new THREE.MeshBasicMaterial({ color: 0xff3040, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false, toneMapped: false });
const ctx = {
  scene, fx, player, bots, ghostMat, difficulty: 1,
  enemiesOf: (team) => (team === 'red' ? [player, ...bots.filter((b) => b.team === 'blue')] : bots.filter((b) => b.team === 'red')),
  resolve,
  hotspot: (team) => { const spots = [[0, -20], [0, 0], [0, 20], [-35, -10], [35, 10], [-35, 25], [35, -25], [-10, 0], [10, -30], [-10, 30], [28, 0], [-28, -30]]; const s = spots[Math.floor(Math.random() * spots.length)]; return freeCellNear(s[0], s[1], 5); },
  hurt: (victim, dmg, from, point, dir, t) => {
    if (victim === player) { if (player.damage(dmg, t)) onDeath(player, from); else { hurtK = 1; sfx.hurt(); } }
    else if (victim.damage(dmg, from, t, point, dir)) onDeath(victim, from);
  },
  explode: (p, bomber) => {
    fx.explosion(p); sfx.explode(p); blast(p, 3.6, 7.5);
    for (const v of [player, ...bots]) { if (v.dead || v === bomber) continue; const d = v.pos.distanceTo(p); if (d < 7 && v.team !== bomber.team) ctx.hurt(v, Math.round(140 * (1 - d / 7)), bomber, p, new THREE.Vector3(0, 1, 0), time); }
    if (player.pos.distanceTo(p) < 12) player.kick += 0.08 * (1 - player.pos.distanceTo(p) / 12);
    setTimeout(() => ctx.remove(bomber), 1500);
  },
  remove: (b) => { const i = bots.indexOf(b); if (i >= 0) bots.splice(i, 1); b.ch.dispose(scene); },
};
function spawnPoint(team) { const z = team === 'blue' ? 36 + Math.random() * 6 : -42 + Math.random() * 6; const lanes = [0, -2.8, 2.8, 5.5, -5.5, 35.5, -35.5]; const x = lanes[Math.floor(Math.random() * lanes.length)]; return freeCellNear(x, z, 3); }
function onDeath(victim, killer) {
  const kName = killer ? killer.name : '?', kTeam = killer ? killer.team : 'red';
  hud.feed(kName, kTeam, victim.name, victim.team);
  if (killer && killer.team !== victim.team && !MATCH.over) { score[killer.team] += 2; if (killer.kills !== undefined) killer.kills++; }
  if (killer === player) {
    hud.points('+100'); hud.hit(true); sfx.kill(); killStreak = time - streakT < 4 ? killStreak + 1 : 1; streakT = time;
    if (killStreak === 2) hud.killText('DOUBLE KILL'); else if (killStreak === 3) hud.killText('TRIPLE KILL'); else if (killStreak >= 4) hud.killText('RAMPAGE');
    for (const n in ab) { if (ab[n].have < ab[n].need) { ab[n].have++; if (ab[n].have === ab[n].need) { hud.callout(ab[n].name + ' READY', ab[n].sub, $('ab' + n).querySelector('svg').outerHTML); sfx.ding(); } } }
  } else if (killer && killer.team === 'blue' && killer !== player && victim.team === 'red' && victim.lastAttacker === player) { hud.points('+25'); hud.killText('KILL ASSIST'); }
  if (victim === player) { respawnAt = time + 4; hud.hurt(1); sfx.death(); } else sfx.deathAt(victim.pos);
  hud.score(score.red, score.blue);
  if (!MATCH.over && (score.red >= MATCH.limit || score.blue >= MATCH.limit)) endMatch();
}
function useAbility(n) {
  const a = ab[n]; if (!a || a.have < a.need || player.dead || MATCH.over) return; a.have = 0; sfx.ability();
  if (n == 4) { sfx.snitch(); snitchUntil = time + 12; hud.callout('CALLED A SNITCH ON THE OPPS', 'ENEMIES MARKED 12 s'); for (const b of bots) if (b.team === 'red') b.spotted = time + 12; }
  if (n == 5) { sfx.homies(); hud.callout('HOMIES INCOMING', 'TWO ON YOUR SIX · 40 s'); for (let i = 0; i < 2; i++) { const p = freeCellNear(player.pos.x + (Math.random() - 0.5) * 6, player.pos.z + (Math.random() - 0.5) * 6, 3); bots.push(new Bot(ctx, trooper, 'blue', p, { kind: 'homie', owner: player, expires: time + 40, name: i ? 'Lil Homie' : 'Big Homie' })); } }
  if (n == 6) { hud.callout('BOMBER SENT', 'HE RUNS AT THE NEAREST OPP'); const p = freeCellNear(player.pos.x, player.pos.z + 2, 3); const b = new Bot(ctx, trooper, 'blue', p, { kind: 'bomber', owner: player, expires: time + 25, name: 'Bomber', speed: 5 }); b.lastSeen = ctx.hotspot('blue'); bots.push(b); }
}
function endMatch() {
  MATCH.over = true; $('touch').classList.remove('on'); const win = score.blue > score.red; if (win) sfx.victory(); else sfx.defeat(); $('ov').classList.remove('off'); $('end').textContent = win ? 'VICTORY' : score.blue === score.red ? 'DRAW' : 'DEFEAT';
  $('pmsg').textContent = `BLUE ${score.blue} · RED ${score.red} · YOU ${player.kills} KILLS / ${player.deaths} DEATHS`; $('go').textContent = 'Run it back'; $('go').classList.add('on'); $('hint').textContent = '';
  submitMatch();
  if (document.exitPointerLock) document.exitPointerLock();
}
function startMatch() {
  score.red = score.blue = 0; MATCH.left = MATCH.time; MATCH.over = false; MATCH.started = true; for (const n in ab) ab[n].have = 0; snitchUntil = 0;
  for (const b of bots) ctx.remove(b); bots.length = 0;
  for (let i = 0; i < 5; i++) bots.push(new Bot(ctx, trooper, 'blue', spawnPoint('blue')));
  for (let i = 0; i < 6; i++) bots.push(new Bot(ctx, trooper, 'red', spawnPoint('red')));
  player.respawn(spawnPoint('blue')); for (const k in guns) { const g = guns[k]; g.mag = g.magSize; g.reserve = g.spec.reserve; g.holstered = k !== 'ak'; g.reloading = 0; } launcher.loaded = 1; launcher.reserve = 3; arsenal.cur = 'ak'; player.kills = 0; player.deaths = 0;
  hud.score(0, 0); $('ov').classList.add('off'); $('lmsg').textContent = ''; $('lboard').classList.remove('on'); requestLock(); unlockAudio(); if (TOUCH) $('touch').classList.add('on');
  setTimeout(() => { if (MATCH.started && !MATCH.over) hud.callout(Q.mobile ? 'TAP SWAP TO CYCLE GUNS' : 'PRESS 2 TO ARM THE RPG-7', Q.mobile ? 'MAC-10 · MP5 · M700 · RPG-7' : '3 MAC-10 · 7 MP5 · 8 SNIPER · Q CYCLES'); }, 1800);
}

// ---------- loading ----------
const pbar = $('pbar'), pmsg = $('pmsg');
let loadedFrac = 0; manager.onProgress = (u, l, t) => { pbar.style.width = Math.round(Math.max(loadedFrac, l / t) * 100) + '%'; };
async function boot() {
  initInput(canvas, () => unlockAudio());
  pmsg.textContent = 'Lighting the sky…';
  // sky: a real photographed dusk HDRI, unblurred, used for both the backdrop and the PBR environment.
  // ?sky=<slug>&skyi=<bg intensity>&skyr=<rotation rad>&envi=<env intensity> for comparisons.
  // Presets measured with qa/sky-analyze.mjs: rotation puts the afterglow down the street, clamp kills the
  // photographed floodlights (rooftop_night has three at ~20-33x), fog = the sky's own horizon colour.
  const SKIES = {
    rooftop_night: { bg: 1.1, rot: 3.14, env: 0.6, clamp: 1.2, fog: 0x4d4258, fogNear: 22, fogFar: 150, key: [0xb8b0d8, 1.5], hemi: [0x8a7aa6, 0x1d1a17, 0.5], rim: [0xffb28a, 0.45] },
    the_sky_is_on_fire: { bg: 0.45, rot: 2.6, env: 0.45, clamp: 12, fog: 0x6a5460, fogNear: 22, fogFar: 150, key: [0xffc9a0, 2.0], hemi: [0x9a86a8, 0x1d1a17, 0.5], rim: [0xffa06a, 0.3] },
  };
  const skyName = SKIES[qs.get('sky')] ? qs.get('sky') : 'rooftop_night';
  const SKY = { name: skyName, ...SKIES[skyName] };
  if (qs.get('skyi')) SKY.bg = +qs.get('skyi'); if (qs.get('skyr')) SKY.rot = +qs.get('skyr'); if (qs.get('envi')) SKY.env = +qs.get('envi'); if (qs.get('fog')) SKY.fog = parseInt(qs.get('fog'), 16);
  const hdr = await loadHDR(`assets/ph/hdri/${SKY.name}_2k.hdr`);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  if (SKY.clamp && hdr.image?.data) { // clamp baked lamps/sun so they neither flare in the backdrop nor dot the reflections
    const d = hdr.image.data, half = d instanceof Uint16Array;
    for (let i = 0; i < d.length; i++) { if ((i & 3) === 3) continue; const v = half ? THREE.DataUtils.fromHalfFloat(d[i]) : d[i]; if (v > SKY.clamp) d[i] = half ? THREE.DataUtils.toHalfFloat(SKY.clamp) : SKY.clamp; }
    hdr.needsUpdate = true;
  }
  scene.fog.color.setHex(SKY.fog); scene.fog.near = SKY.fogNear; scene.fog.far = SKY.fogFar;
  key.color.setHex(SKY.key[0]); key.intensity = SKY.key[1]; hemi.color.setHex(SKY.hemi[0]); hemi.groundColor.setHex(SKY.hemi[1]); hemi.intensity = SKY.hemi[2]; rim.color.setHex(SKY.rim[0]); rim.intensity = SKY.rim[1];
  const pm = new THREE.PMREMGenerator(renderer); pm.compileEquirectangularShader();
  scene.environment = pm.fromEquirectangular(hdr).texture; scene.environmentIntensity = SKY.env; scene.environmentRotation = new THREE.Euler(0, SKY.rot, 0);
  scene.background = hdr; scene.backgroundIntensity = SKY.bg; scene.backgroundBlurriness = 0; scene.backgroundRotation = new THREE.Euler(0, SKY.rot, 0);
  window.__sky = SKY;
  pmsg.textContent = 'Building the block…';
  await buildWorld(scene, Q, (f) => { loadedFrac = f; pbar.style.width = Math.round(f * 100) + '%'; });
  // street lamp lights (real point lights) + emissive bulbs
  const bulbGeo = new THREE.SphereGeometry(0.11, 10, 8), bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
  for (const l of lamps) {
    if (!l.far) { const pl = new THREE.PointLight(l.alley ? 0xffc27a : 0xffb46a, l.alley ? 90 : 150, l.alley ? 20 : 28, 2); pl.position.set(l.x, l.y, l.z); scene.add(pl); }
    const bulb = new THREE.Mesh(bulbGeo, bulbMat); bulb.position.set(l.x, l.y + 0.05, l.z); bulb.scale.set(1, 1.3, 1); scene.add(bulb);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: fx.flashMat.map, color: 0xffb060, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55, toneMapped: false })); glow.position.copy(bulb.position); glow.scale.setScalar(1.6); scene.add(glow);
  }
  // destructible brick walls: front-yard walls on the WALL_LOTS lots (two segments each, a gap at the walkway) + two free-standing ones
  for (const key of WALL_LOTS) {
    const [s, i] = key.split(':').map(Number); const z0 = -40 + i * GEO.LOT, z1 = z0 + GEO.LOT, x = s * (GEO.ROAD_HALF + GEO.SIDEWALK + 1.4);
    const wz = (z0 + z1) / 2 + (s < 0 ? GEO.HOUSE_W / 4 : -GEO.HOUSE_W / 4);
    const a0 = z0 + 0.3, a1 = wz - 0.9, b0 = wz + 0.9, b1 = z1 - 0.3;
    addWall(scene, wallSpec(x, (a0 + a1) / 2, a1 - a0, 7, 1)); addWall(scene, wallSpec(x, (b0 + b1) / 2, b1 - b0, 7, 1));
  }
  addWall(scene, wallSpec(-12, 42.2, 6.4, 8, 0)); addWall(scene, wallSpec(12, -42.2, 6.4, 8, 0));
  const nh = qs.get('nhouses') ? +qs.get('nhouses') : houseDescs.length; for (let i = 0; i < houseDescs.length; i++) { if (i < nh) addHouse(scene, houseDescs[i]); }
  pmsg.textContent = 'Welding the bricks…';
  const physMode = await initDestruction(scene, { enabled: qs.get('phys') !== '0' });
  console.log('destruction mode:', physMode, 'blocks:', destruction.blocks);
  // brick dust thrown off a broken wall (photographic puffs, tinted brick-brown, lit low for the night scene)
  destruction.onBlast = (p, n) => { for (let i = 0; i < Math.min(12, 4 + (n >> 3)); i++) fx.billow('puff', p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3)), new THREE.Vector3((Math.random() - 0.5) * 4, 0.4 + Math.random() * 1.6, (Math.random() - 0.5) * 4), 2.2 + Math.random() * 1.6, 0.9, 4 + Math.random() * 2, { op: 0.75, tint: [0.085, 0.05, 0.035], drag: 1.8, rise: 0.15 }); };
  pmsg.textContent = 'Loading the AK…';
  await Promise.all(Object.values(guns).map((g) => g.load())); await launcher.load();
  pmsg.textContent = 'Calling the homies…';
  await loadCharacters(weapon.template3p);
  for (const g of Object.values(guns)) {
    g.rayTargets = (o, d, maxT) => rayVsBots(o, d, maxT, bots.filter((b) => b.team === 'red' || b.kind === 'bomber'));
    g.onHit = (bot, dmg, point, dir) => { hud.hit(false); sfx.hit(); if (bot.damage(dmg, player, time, point, dir)) onDeath(bot, player); };
  }
  launcher.rayTargets = (o, d, maxT, owner) => rayVsBots(o, d, maxT, bots.filter((b) => b !== owner && (owner !== player || b.team === 'red' || b.kind === 'bomber')));
  launcher.onExplode = (p, owner, t) => {
    for (const v of [player, ...bots]) {
      if (v.dead) continue; const d = v.pos.distanceTo(p); if (d > 6.5) continue;
      const self = v === owner; if (!self && owner && v.team === owner.team && v !== player) continue;
      const dmg = Math.round((self ? 60 : 130) * (1 - d / 6.5));
      if (dmg > 0) ctx.hurt(v, dmg, owner, p, new THREE.Vector3(0, 1, 0), t);
    }
    const pd = player.pos.distanceTo(p); if (pd < 14) { player.kick += 0.1 * (1 - pd / 14); hurtK = Math.max(hurtK, 0.35 * (1 - pd / 14)); }
    sfx.rubbleAt(p);
  };
  buildNav(); initHud();
  if (qs.get('nohud') === '1') { document.getElementById('hud').style.display = 'none'; document.getElementById('touch').style.display = 'none'; }
  pmsg.textContent = 'Warming shaders…';
  snapShadow(player.pos);
  const warm = [fx.tracers[0].m, fx.flashes[0].s, fx.parts[0].s, fx.decals[0], ...launcher.pool.map((p) => p.obj)];
  for (const o of warm) o.visible = true; fx.parts[0].s.material = fx.boomMat; fx.parts[1].s.material = fx.bloodMat; fx.parts[1].s.visible = true; fx.parts[2].s.material = fx.sparkMat; fx.parts[2].s.visible = true;
  fx.cam = camera; fx.warm(true);
  renderer.compile(scene, camera); composer.render();
  fx.warm(false);
  for (const o of warm) o.visible = false; fx.parts[1].s.visible = false; fx.parts[2].s.visible = false; fx.parts[0].s.material = fx.parts[1].s.material = fx.parts[2].s.material = fx.dustMat;
  pbar.style.width = '100%'; pmsg.textContent = Q.mobile ? 'Left thumb moves · right thumb aims · hold FIRE' : 'Click DEPLOY, then the mouse is locked to the game';
  $('go').classList.add('on');
  $('go').addEventListener('click', () => { startMatch(); });
  $('gname').value = ident.name || ''; $('gwallet').value = ident.wallet || ''; for (const id of ['gname', 'gwallet']) $(id).addEventListener('change', saveIdent);
  if (location.pathname.startsWith('/play/')) $('ladder').href = '../leaderboard.html';
  if (Q.mobile) pmsg.textContent += ' · SWAP arms the RPG';
  if (qs.get('auto') === '1') startMatch();
  requestAnimationFrame(loop);
}

// ---------- loop ----------
let last = performance.now(), fpsAcc = 0, fpsN = 0, nextDistant = 12;
addEventListener('keydown', (e) => { if (e.target && e.target.tagName === 'INPUT') return; if (e.code === 'KeyM') { setMuted(!isMuted()); hud.callout(isMuted() ? 'SOUND OFF' : 'SOUND ON', 'PRESS [M]'); } });
const labelItems = [], dots = [];
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
  fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { hud.fps(Math.round(fpsN / fpsAcc)); fpsAcc = 0; fpsN = 0; }
  const look = poll();
  if (!MATCH.started || (!input.locked && !TOUCH && !MATCH.over && MATCH.started)) { look.dx = look.dy = 0; }
  if (!MATCH.started) { // idle camera drift on the title
    player.yaw += dt * 0.03; player.update(dt, { moveX: 0, moveY: 0 }, { dx: 0, dy: 0 }, time);
  } else {
    if (!MATCH.over) { MATCH.left -= dt; hud.timer(MATCH.left); if (MATCH.left <= 0) endMatch(); }
    if (input.ab) { useAbility(input.ab); input.ab = 0; }
    player.update(dt, MATCH.over ? { moveX: 0, moveY: 0 } : input, look, time);
    if (player.stepped && !player.dead) sfx.step();
    if (input.swap && !player.dead) {
      const i0 = ORDER.indexOf(arsenal.cur); const want = input.swap === 'next' || input.swap === 'toggle' ? ORDER[(i0 + 1) % ORDER.length] : input.swap === 'prev' ? ORDER[(i0 + ORDER.length - 1) % ORDER.length] : input.swap;
      if (ORDER.includes(want) && want !== arsenal.cur) {
        arsenal.cur = want; for (const k in guns) guns[k].holstered = k !== want;
        const g = guns[want]; hud.callout(want === 'rpg' ? 'RPG-7' : g.name, want === 'rpg' ? `${launcher.loaded + launcher.reserve} ROCKETS` : `${g.mag + g.reserve} ROUNDS`);
      }
    }
    input.swap = '';
    const idle = { fire: false, ads: false, reload: false }, live = MATCH.over ? { fire: false } : input;
    for (const k in guns) { const g = guns[k]; g.baseFov = weapon.baseFov; g.portrait = weapon.portrait; g.fovOwner = arsenal.cur === k || (arsenal.cur === 'rpg' && k === 'ak'); g.update(dt, arsenal.cur === k ? live : idle, look, time); }
    { const g = guns.m700, on = arsenal.cur === 'm700' && g.ads > 0.85; document.getElementById('scope').classList.toggle('on', on); document.getElementById('xh').style.visibility = on ? 'hidden' : ''; }
    launcher.portrait = weapon.portrait; launcher.update(dt, MATCH.over ? { fire: false } : input, look, time, arsenal.cur === 'rpg');
    for (const b of bots) {
      if (b.dead && b.respawnAt && time > b.respawnAt && !b.expires && !MATCH.over) b.respawn(spawnPoint(b.team));
      b.update(dt, time);
    }
    if (player.dead && time > respawnAt && !MATCH.over) { player.respawn(spawnPoint('blue')); for (const g of Object.values(guns)) g.mag = g.magSize; launcher.loaded = 1; launcher.reserve = 3; hud.hurt(0); }
  }
  fx.update(dt); updateDestruction(dt);
  if (fx.shake > 0.001) { const a = fx.shake * fx.shake; camera.position.x += (Math.random() - 0.5) * 0.16 * a; camera.position.y += (Math.random() - 0.5) * 0.12 * a; camera.rotation.z += (Math.random() - 0.5) * 0.03 * a; }
  hurtK = Math.max(0, hurtK - dt * 1.6); grade.uniforms.hurt.value = player.dead ? 0.9 : hurtK * 0.8 + (1 - player.hp / player.maxHp) * 0.35; hud.hurt(player.dead ? 0.8 : hurtK * 0.7);
  grade.uniforms.time.value = time;
  snapShadow(player.pos);
  setListener(camera.position, player.yaw);
  if (MATCH.started && !MATCH.over && time > nextDistant) { sfx.distantGunfire(); nextDistant = time + 18 + Math.random() * 30; }
  // HUD
  if (MATCH.started) {
    if (arsenal.cur === 'rpg') hud.ammo(launcher.loaded, launcher.reserve, player.kills, 'RPG-7'); else { const g = curGun(); hud.ammo(g.mag, g.reserve, player.kills, g.name); }
    const snitch = time < snitchUntil; for (const n in ab) hud.ability(n, ab[n].have / ab[n].need, ab[n].have >= ab[n].need);
    labelItems.length = 0; dots.length = 0;
    for (const b of bots) {
      if (b.dead) continue; const d = Math.round(b.pos.distanceTo(player.pos));
      const spotted = snitch || (b.spotted && time < b.spotted);
      b.ch.ghostVisible = b.team === 'red' && snitch;
      dots.push({ pos: b.pos, team: b.team, spotted });
      if (b.team === 'blue') labelItems.push({ pos: new THREE.Vector3(b.pos.x, b.pos.y + 2.05, b.pos.z), name: '', team: 'blue', dist: d });
      else if (spotted) labelItems.push({ pos: new THREE.Vector3(b.pos.x, b.pos.y + 2.05, b.pos.z), name: b.name, team: 'red', dist: d });
    }
    hud.labels(camera, labelItems); hud.minimap(player, dots, snitch);
  }
  composer.render();
}
boot().catch((e) => { console.error(e); pmsg.textContent = 'Could not start: ' + e.message; });
// expose for QA
window.__hw = { scene, camera, player, bots, weapon, guns, launcher, arsenal, destruction, score, MATCH, startMatch, useAbility, Q, renderer, input, THREE, fx };
