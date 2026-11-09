import {
  World, Connectivity, Mesher, Bodies, CHUNKS, BODIES, QUEUE,
  VERTEX_WORDS, STATIC_CAP, BODY_CAP, STEP, seedWorld, raycast, blast
} from './engine.js';
import {TransferPool} from './protocol.js';
import {Walker,Chips} from './motion.js';

const world = new World(), support = new Connectivity(), mesher = new Mesher();
const bodies = new Bodies(), pool = new TransferPool();
const walker = new Walker(), chips = new Chips();
const dirty = new Uint8Array(CHUNKS), hit = new Int32Array(3), slab = new Float64Array(3);
const queue = [];
const WAIT = Symbol('waiting for transfer credit');
let epoch = 0, id = 0, applied = -1, job, awaiting = false, timer = null, mask = 0;
let droppedBodies = 0, lastTick = 0, carry = 0, sliceMax = 0, sliceCount = 0, sliceTotal = 0;
let queueHigh = 0;
let charge = null, removed = 0;

function* mesh(source, section, target, cap) {
  let slot;
  while ((slot = pool.take()) < 0) yield WAIT;
  const buffer = pool.buffers[slot];
  const vertices = new Uint32Array(buffer, 0, cap*4);
  const indices = new Uint32Array(buffer, VERTEX_WORDS*4, cap*6);
  const quads = yield* mesher.mesh(source,section,vertices,indices);
  mask |= 1 << target;
  pool.lend(slot);
  postMessage({type:'mesh',epoch,id,slot,target,quads,buffer},[buffer]);
}

function* present(island) {
  const slot = bodies.reserve(island);
  if (slot < 0) { droppedBodies++; return; }
  const first = island.bounds[0] >> 5, last = island.bounds[3] >> 5;
  for (let section = first; section <= last; section++) {
    yield* mesh(island.island,section,CHUNKS + slot*CHUNKS + section,BODY_CAP);
  }
}

function* transaction(command) {
  id = command.id;
  dirty.fill(0);
  mask = 0;
  removed = 0;
  if (id === 0) {
    yield* seedWorld(world);
    dirty.fill(1);
  } else {
    if (command.charge && charge) {
      hit.set(charge.cell);
      charge = null;
    } else {
      const reach = Number.isFinite(command.reach) ? Math.max(0,Math.min(100,command.reach)) : Infinity;
      if (!raycast(world,command.origin,command.direction,hit,slab,reach)) return;
      if (command.charge) {
        const pose = Array.from(hit,value => value+.5);
        let axis = 0;
        for (let i = 1; i < 3; i++) {
          if (Math.abs(command.direction[i]) > Math.abs(command.direction[axis])) axis = i;
        }
        pose[axis] -= Math.sign(command.direction[axis])*.62;
        charge = {cell:Array.from(hit),pose};
        return;
      }
    }
    if (command.rocket) {
      const x = hit[0]+.5, y = hit[1]+.5, z = hit[2]+.5;
      const ms = Math.max(70,Math.hypot(x-command.origin[0],y-command.origin[1],z-command.origin[2])*9);
      postMessage({type:'launch',epoch,id,origin:command.origin,x,y,z,ms});
      yield ms;
    }
    removed = yield* blast(world,hit[0],hit[1],hit[2],command.radius,dirty,chips);
    if (removed) yield* support.detach(world,dirty,present);
  }
  for (let section = 0; section < CHUNKS; section++) {
    if (dirty[section]) yield* mesh(world,section,section,STATIC_CAP);
  }
}

function schedule() {
  if (timer !== null || awaiting || (!job && !queue.length)) return;
  timer = setTimeout(pump,0);
}

function pump() {
  timer = null;
  if (awaiting) return;
  if (!job) {
    if (!queue.length) return;
    job = transaction(queue.shift());
  }
  const start = performance.now();
  let waiting = false;
  do {
    for (let i = 0; i < 16; i++) {
      const next = job.next();
      if (next.done) {
        job = null;
        awaiting = true;
        break;
      }
      if (typeof next.value === 'number') {
        timer = setTimeout(pump,next.value);
        waiting = true;
        break;
      }
      if (next.value === WAIT) { waiting = true; break; }
    }
  } while (job && !waiting && performance.now() - start < 2);
  const elapsed = performance.now() - start;
  sliceCount++;
  sliceTotal += elapsed;
  sliceMax = Math.max(sliceMax,elapsed);
  if (awaiting) postMessage({type:'end',epoch,id,mask,chips:chips.sample(1),charge,removed});
  else if (!waiting) schedule();
}

function tick({dx,dz}) {
  const now = performance.now();
  if (lastTick) carry += Math.min((now-lastTick)/1000,STEP*4);
  lastTick = now;
  let steps = 0;
  while (carry >= STEP && steps++ < 4) {
    bodies.step();
    chips.step(world);
    walker.step(world,dx,dz);
    carry -= STEP;
  }
  const pose = {type:'pose',epoch,id:applied,sliceCount,sliceTotal,sliceMax,queueHigh,droppedBodies,
    x:walker.x,z:walker.z,feet:walker.feet,chips:chips.sample(2)};
  for (let i = 0; i < BODIES; i++) pose[i] = bodies.state[i] === 2 ? bodies.y[i] : null;
  postMessage(pose);
}

self.onmessage = ({data: m}) => {
  if (m.type === 'recycle') {
    pool.recycle(m.slot,m.buffer);
    schedule();
    return;
  }
  if (m.type === 'reset' && m.epoch > epoch) {
    clearTimeout(timer);
    timer = null;
    epoch = m.epoch;
    applied = -1;
    charge = null;
    queue.length = 0;
    queue.push({id:0});
    job = null;
    awaiting = false;
    bodies.state.fill(0);
    chips.state.fill(0);
    walker.reset();
    support.island.clear();
    lastTick = carry = 0;
    schedule();
    return;
  }
  if (m.epoch !== epoch) return;
  if (m.type === 'tick') tick(m);
  if (m.type === 'pause') lastTick = carry = 0;
  if (m.type === 'blast') {
    if (queue.length + Number(Boolean(job || awaiting)) >= QUEUE) {
      throw new Error('Input credit exceeded.');
    }
    queue.push(m);
    queueHigh = Math.max(queueHigh,queue.length + Number(Boolean(job || awaiting)));
    schedule();
  }
  if (m.type === 'activate' && awaiting && m.id === id) {
    awaiting = false;
    applied = id;
    bodies.activate();
    chips.activate();
    schedule();
  }
};
