// Keyboard + mouse (pointer lock) on desktop, twin-stick touch on phones.
export const TOUCH = matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window;
export const keys = {};
export const input = { yaw: 0, pitch: 0, mx: 0, my: 0, fire: false, ads: false, jump: false, reload: false, sprint: false, crouch: false, ab: 0, locked: false, moveX: 0, moveY: 0, swap: '' };
let canvas, onFirst = null;
export function initInput(c, firstGesture) {
  canvas = c; onFirst = firstGesture;
  addEventListener('keydown', (e) => { if (e.target && e.target.tagName === 'INPUT') return; keys[e.code] = true; if (e.code === 'KeyR') input.reload = true; if (e.code === 'Space') { input.jump = true; e.preventDefault(); } if (/^Digit[456]$/.test(e.code)) input.ab = +e.code.slice(5); if (e.code === 'Digit1') input.swap = 'ak'; if (e.code === 'Digit2') input.swap = 'rpg'; if (e.code === 'Digit3') input.swap = 'mac10'; if (e.code === 'Digit7') input.swap = 'mp5'; if (e.code === 'Digit8') input.swap = 'm700'; if (e.code === 'KeyQ') input.swap = 'next'; if (e.code === 'KeyC') input.crouch = !input.crouch; });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  let wheelT = 0; addEventListener('wheel', (e) => { const now = performance.now(); if (now - wheelT < 160 || !input.locked) return; wheelT = now; input.swap = e.deltaY > 0 ? 'next' : 'prev'; }, { passive: true });
  canvas.addEventListener('mousedown', (e) => { onFirst?.(); if (!TOUCH && !input.locked) { canvas.requestPointerLock?.(); return; } if (e.button === 0) input.fire = true; if (e.button === 2) input.ads = true; });
  addEventListener('mouseup', (e) => { if (e.button === 0) input.fire = false; if (e.button === 2) input.ads = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => { input.locked = document.pointerLockElement === canvas; if (!input.locked) { input.fire = false; input.ads = false; } });
  addEventListener('mousemove', (e) => { if (!input.locked) return; input.mx += e.movementX; input.my += e.movementY; });
  if (TOUCH) initTouch();
}
export function requestLock() { if (!TOUCH) canvas?.requestPointerLock?.(); }
export function poll() {
  if (!TOUCH) {
    input.moveX = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    input.moveY = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    input.sprint = !!keys.ShiftLeft || !!keys.ShiftRight;
  }
  const dx = input.mx, dy = input.my; input.mx = 0; input.my = 0;
  return { dx, dy };
}
function initTouch() {
  const hint = document.getElementById('hint'); if (hint) hint.innerHTML = '<b>TAP SWAP TO CYCLE GUNS</b> · AK-47 → MAC-10 → MP5 → M700 → RPG-7<br>Left thumb: move stick · right thumb: look · hold FIRE · tap AIM to toggle · 4 5 6 abilities';
  const stick = { id: null, x0: 0, y0: 0 }, look = { id: null, x: 0, y: 0 };
  const sEl = document.getElementById('stick'), knob = document.getElementById('knob');
  canvas.addEventListener('touchstart', (e) => {
    onFirst?.();
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.42 && t.clientY > innerHeight * 0.35 && stick.id === null) { stick.id = t.identifier; stick.x0 = t.clientX; stick.y0 = t.clientY; sEl.style.left = (t.clientX - 55) + 'px'; sEl.style.top = (t.clientY - 55) + 'px'; sEl.style.display = 'block'; knob.style.transform = ''; }
      else if (look.id === null) { look.id = t.identifier; look.x = t.clientX; look.y = t.clientY; }
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) { let dx = t.clientX - stick.x0, dy = t.clientY - stick.y0; const d = Math.hypot(dx, dy); if (d > 48) { dx *= 48 / d; dy *= 48 / d; } input.moveX = dx / 48; input.moveY = -dy / 48; input.sprint = d > 44; knob.style.transform = `translate(${dx}px,${dy}px)`; }
      else if (t.identifier === look.id) { input.mx += (t.clientX - look.x) * 2.2; input.my += (t.clientY - look.y) * 2.2; look.x = t.clientX; look.y = t.clientY; }
    }
    e.preventDefault();
  }, { passive: false });
  const end = (e) => { for (const t of e.changedTouches) { if (t.identifier === stick.id) { stick.id = null; input.moveX = input.moveY = 0; input.sprint = false; sEl.style.display = 'none'; } if (t.identifier === look.id) look.id = null; } };
  canvas.addEventListener('touchend', end); canvas.addEventListener('touchcancel', end);
  const btn = (id, down, up) => { const el = document.getElementById(id); el.addEventListener('touchstart', (e) => { onFirst?.(); el.classList.add('down'); down(); e.preventDefault(); }, { passive: false }); el.addEventListener('touchend', (e) => { el.classList.remove('down'); up?.(); e.preventDefault(); }, { passive: false }); };
  btn('tFire', () => { input.fire = true; }, () => { input.fire = false; });
  btn('tFire2', () => { input.fire = true; }, () => { input.fire = false; });
  btn('tAds', () => { input.ads = !input.ads; });
  btn('tJump', () => { input.jump = true; });
  btn('tReload', () => { input.reload = true; });
  btn('tSwap', () => { input.swap = 'next'; });
  for (const n of [4, 5, 6]) { const el = document.getElementById('ab' + n); el.addEventListener('touchstart', (e) => { input.ab = n; e.preventDefault(); }, { passive: false }); }
}
