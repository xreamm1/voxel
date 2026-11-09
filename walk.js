import {EYE,SPAWN_X,SPAWN_Z} from './motion.js';

export function walking(canvas,camera,controls,home) {
  const button = document.querySelector('#walk'), move = document.querySelector('#move');
  const reticle = document.querySelector('#reticle'), help = document.querySelector('#help');
  const keys = new Set(), touches = new Map();
  const movement = new Float64Array(2);
  let yaw, pitch, x, z, feet;
  const state = {
    active:false,
    reset() {
      yaw = pitch = feet = 0;
      x = SPAWN_X;
      z = SPAWN_Z;
      keys.clear();
      touches.clear();
    },
    pose(m) { x = m.x; z = m.z; feet = m.feet; },
    look(dx,dY) {
      yaw -= dx * .004;
      pitch = Math.min(1.52,Math.max(-1.52,pitch-dY*.004));
    },
    aim() {
      camera.position.set(x,feet+EYE,z);
      camera.rotation.set(pitch,yaw,0,'YXZ');
      camera.updateMatrixWorld();
    },
    movement() {
      const forward = Number(held('KeyW')) - Number(held('KeyS'));
      const right = Number(held('KeyD')) - Number(held('KeyA'));
      movement[0] = state.active ? right*Math.cos(yaw)-forward*Math.sin(yaw) : 0;
      movement[1] = state.active ? -right*Math.sin(yaw)-forward*Math.cos(yaw) : 0;
      return movement;
    },
    ready(enabled) { button.disabled = !enabled; }
  };
  function held(key) {
    if (keys.has(key)) return true;
    for (const value of touches.values()) if (value === key) return true;
    return false;
  }
  state.reset();
  button.setAttribute('aria-pressed','false');
  button.addEventListener('click',() => {
    state.active = !state.active;
    controls.enabled = !state.active;
    reticle.hidden = move.hidden = !state.active;
    button.setAttribute('aria-pressed',String(state.active));
    button.textContent = state.active ? 'Orbit' : 'Walk';
    help.textContent = state.active ?
      'WASD or arrows below to walk · Drag to aim · Tap to blast' :
      'Tap to blast · Drag to orbit · Pinch or scroll to zoom';
    keys.clear();
    touches.clear();
    if (state.active) state.aim(); else home();
  });
  const bindings = {KeyW:'KeyW',KeyA:'KeyA',KeyS:'KeyS',KeyD:'KeyD',
    ArrowUp:'KeyW',ArrowLeft:'KeyA',ArrowDown:'KeyS',ArrowRight:'KeyD'};
  addEventListener('keydown',event => {
    const key = bindings[event.code];
    if (!state.active || !key) return;
    event.preventDefault();
    keys.add(key);
  });
  addEventListener('keyup',event => keys.delete(bindings[event.code]));
  function release() { keys.clear(); touches.clear(); }
  addEventListener('blur',release);
  document.addEventListener('visibilitychange',release);
  for (const target of move.querySelectorAll('button')) {
    target.addEventListener('pointerdown',event => {
      event.preventDefault();
      target.setPointerCapture(event.pointerId);
      touches.set(event.pointerId,target.dataset.key);
    });
    for (const type of ['pointerup','pointercancel','lostpointercapture']) {
      target.addEventListener(type,event => touches.delete(event.pointerId));
    }
  }
  return state;
}
