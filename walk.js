import {EYE,SPAWN_FEET,SPAWN_X,SPAWN_Z} from './motion.js';

export function walking(canvas,camera,controls,home) {
  const button = document.querySelector('#walk'), move = document.querySelector('#move');
  const reticle = document.querySelector('#reticle'), help = document.querySelector('#help');
  const view = document.querySelector('#view'), tools = document.querySelector('#tools');
  const name = document.querySelector('#tool-name'), menu = document.querySelector('#loadout');
  const groups = [...document.querySelectorAll('[data-group]')];
  const loadout = [
    {name:'Sledge',group:1,radius:2.5,reach:4,cooldown:1617,animation:1617,equip:1000},
    {name:'Huge Hammer',group:1,radius:4,reach:5,cooldown:1800,animation:1617,equip:1000},
    {name:'Pickaxe',group:1,radius:1,reach:4,cooldown:680,animation:550,equip:250},
    {name:'Pistol',group:2,radius:.7,reach:35,cooldown:300,animation:190,equip:233},
    {name:'Rifle',group:2,radius:1,reach:60,cooldown:145,animation:145,equip:0},
    {name:'RPG',group:3,radius:5.5,reach:64,cooldown:650,animation:367,equip:0,rocket:true},
    {name:'C4',group:3,radius:6,reach:5,cooldown:450,animation:320,equip:0,charge:true}
  ];
  const keys = new Set(), touches = new Map();
  const movement = new Float64Array(2);
  let yaw, pitch, x, z, feet, phase = 0, stride = 0, swing = -Infinity;
  let selected = 5, third = true, equippedAt = -Infinity, chargePlaced = false;
  function updateLabel() {
    name.textContent = loadout[selected].charge && chargePlaced ? 'Detonate C4' : loadout[selected].name;
    for (const group of groups) {
      group.setAttribute('aria-pressed',String(Number(group.dataset.group) === loadout[selected].group));
    }
  }
  function equip(index) {
    const next = (index+loadout.length)%loadout.length;
    if (next !== selected) {
      selected = next;
      equippedAt = performance.now();
      swing = -Infinity;
    }
    updateLabel();
  }
  function selectGroup(group) {
    const current = loadout[selected].group === group ? selected+1 : 0;
    const next = loadout.findIndex((tool,index) => tool.group === group && index >= current);
    equip(next < 0 ? loadout.findIndex(tool => tool.group === group) : next);
  }
  for (const group of groups) group.onclick = () => selectGroup(Number(group.dataset.group));
  equip(selected);
  document.querySelector('#previous-tool').onclick = () => equip(selected-1);
  document.querySelector('#next-tool').onclick = () => equip(selected+1);
  document.querySelector('#menu').onclick = () => {
    keys.clear();
    touches.clear();
    menu.showModal();
  };
  for (const choice of menu.querySelectorAll('[data-tool]')) {
    choice.onclick = () => { equip(Number(choice.dataset.tool)); menu.close(); };
  }
  function toggleView() {
    third = !third;
    view.setAttribute('aria-label',third ? 'First person' : 'Third person');
    state.aim();
  }
  view.onclick = toggleView;
  const state = {
    active:false,
    get thirdPerson() { return state.active && third; },
    get x() { return x; }, get z() { return z; }, get feet() { return feet; },
    get yaw() { return yaw; }, get gait() { return Math.sin(phase)*stride; },
    get tool() { return selected; },
    get melee() { return loadout[selected].group === 1; },
    setCharge(placed) { chargePlaced = placed; updateLabel(); },
    attack(ray,now) {
      const tool = loadout[selected];
      if (now-swing < tool.cooldown || now-equippedAt < tool.equip) return;
      swing = now;
      ray.origin.set(x,feet+EYE,z);
      ray.direction.set(-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));
      return tool;
    },
    action(now) { return Math.max(0,1-(now-swing)/loadout[selected].animation); },
    equipping(now) {
      const duration = loadout[selected].equip;
      return duration ? Math.max(0,1-(now-equippedAt)/duration) : 0;
    },
    reset() {
      yaw = pitch = 0;
      feet = SPAWN_FEET;
      phase = stride = 0;
      swing = -Infinity;
      equippedAt = -Infinity;
      x = SPAWN_X;
      z = SPAWN_Z;
      keys.clear();
      touches.clear();
    },
    pose(m) {
      const distance = Math.hypot(m.x-x,m.z-z);
      // At full speed (5 m/s), one reference locomotion cycle takes 0.625 s.
      if (distance > .001) phase = (phase + distance*2*Math.PI/(5*.625)) % (2*Math.PI);
      stride = stride*.75 + (distance > .001 ? .25 : 0);
      x = m.x; z = m.z; feet = m.feet;
    },
    look(dx,dY) {
      yaw -= dx * .004;
      pitch = Math.min(1.52,Math.max(-1.52,pitch-dY*.004));
    },
    aim() {
      camera.position.set(x,feet+EYE,z);
      camera.rotation.set(pitch,yaw,0,'YXZ');
      if (third) {
        camera.translateZ(2.53);
        camera.position.y += .55;
        camera.lookAt(x-Math.sin(yaw)*Math.cos(pitch)*12,feet+EYE+Math.sin(pitch)*12,
          z-Math.cos(yaw)*Math.cos(pitch)*12);
      }
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
    camera.fov = state.active ? 70 : 44;
    camera.updateProjectionMatrix();
    reticle.hidden = move.hidden = !state.active;
    view.hidden = tools.hidden = !state.active;
    button.setAttribute('aria-pressed',String(state.active));
    button.textContent = state.active ? 'Orbit' : 'Walk';
    help.textContent = state.active ?
      'WASD to walk · Drag to aim · Tap to use tool · Q/E to switch' :
      'Tap to blast · Drag to orbit · Pinch or scroll to zoom';
    keys.clear();
    touches.clear();
    if (state.active) state.aim(); else home();
  });
  const bindings = {KeyW:'KeyW',KeyA:'KeyA',KeyS:'KeyS',KeyD:'KeyD',
    ArrowUp:'KeyW',ArrowLeft:'KeyA',ArrowDown:'KeyS',ArrowRight:'KeyD'};
  addEventListener('keydown',event => {
    if (!state.active || menu.open) return;
    if (!event.repeat) {
      if (event.code === 'KeyQ') equip(selected-1);
      if (event.code === 'KeyE') equip(selected+1);
      if (event.code === 'KeyV') toggleView();
      if (/^Digit[123]$/.test(event.code)) selectGroup(Number(event.code.at(-1)));
    }
    const key = bindings[event.code];
    if (!key) return;
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
