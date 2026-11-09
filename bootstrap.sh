#!/usr/bin/env bash
set -euo pipefail

die() { printf '%s\n' "$*" >&2; exit 1; }
for tool in node npm git; do
  command -v "$tool" >/dev/null || die "Missing prerequisite: $tool"
done
node -e 'if (![22,24].includes(+process.versions.node.split(".")[0])) process.exit(1)' ||
  die "Use Node.js 22 or 24 LTS."
[[ $# -le 1 ]] || die "Usage: bash bootstrap.sh [GitHub repository URL]"
remote=${1-}
github_pattern='^(https://github\.com/|git@github\.com:)[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+$'
if [[ $# -eq 1 && ! "$remote" =~ $github_pattern ]]; then
  die "Supply a GitHub repository URL such as https://github.com/OWNER/REPO.git."
fi
[[ ! -e voxel-destruction && ! -L voxel-destruction ]] || die "voxel-destruction already exists."
mkdir voxel-destruction
cd voxel-destruction
git init -b main
if [[ -n "$remote" ]]; then git remote add origin "$remote"; fi

cat > package.json <<'PACKAGE'
{
  "name": "voxel-destruction",
  "private": true,
  "type": "module",
  "engines": { "node": "22.x || 24.x" },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "node --test"
  },
  "dependencies": { "three": "0.179.1" },
  "devDependencies": { "vite": "6.4.5" }
}
PACKAGE
cat > .gitignore <<'IGNORE'
node_modules/
dist/
.vite/
IGNORE
cat > index.html <<'HTML'
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Knockout Yard</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="./style.css">
<canvas aria-label="Interactive voxel construction yard"></canvas>
<header><strong>KNOCKOUT YARD</strong><span>01 / DEMOLITION SITE</span></header>
<aside><button id="view" hidden aria-label="First person">View</button> <button id="walk" disabled>Walk</button>
<button id="reset" disabled>Reset yard</button> <button id="menu">Menu</button></aside>
<div id="tools" hidden aria-label="Demolition tools">
  <button id="previous-tool" aria-label="Previous tool">‹</button>
  <output id="tool-name"></output>
  <button id="next-tool" aria-label="Next tool">›</button>
</div>
<dialog id="loadout">
  <form method="dialog"><button aria-label="Close menu">×</button></form>
  <h2>Yard loadout</h2>
  <p>Pick a demolition tool. Q/E cycles the loadout.</p>
  <div class="loadout-tools">
    <button data-tool="0"><small>1 · MELEE</small>Sledge</button>
    <button data-tool="1"><small>2 · FIREARMS</small>Rifle</button>
    <button data-tool="2"><small>3 · EXPLOSIVES</small>RPG</button>
  </div>
</dialog>
<div id="reticle" hidden aria-hidden="true">+</div>
<div id="move" hidden aria-label="Movement controls">
  <button data-key="KeyW" aria-label="Forward">▲</button>
  <button data-key="KeyA" aria-label="Left">◀</button>
  <button data-key="KeyS" aria-label="Back">▼</button>
  <button data-key="KeyD" aria-label="Right">▶</button>
</div>
<footer><span id="status" role="status">Starting the yard…</span><br>
<small id="help">Tap to blast · Drag to orbit · Pinch or scroll to zoom</small></footer>
<pre id="metrics" hidden></pre>
<script type="module" src="./main.js"></script>
</html>
HTML
cat > style.css <<'CSS'
:root { font: 15px system-ui,sans-serif; color: #142633; background: #b9e5fc }
* { box-sizing: border-box }
body { margin: 0; overflow: hidden }
canvas { display: block; width: 100vw; height: 100dvh; touch-action: none }
header, aside, footer, pre { position: fixed; margin: 0 }
header, footer, pre { pointer-events: none }
header { top: 16px; left: 16px; display: grid; gap: 3px }
header strong { font-size: clamp(16px,4vw,27px); letter-spacing: .06em }
header span { font-size: 10px; font-weight: 750; letter-spacing: .16em }
aside { top: 16px; right: 16px }
button, footer, pre { padding: 10px 12px; border-radius: 8px; background: #fffc; color: inherit }
button { border: 1px solid #142633; font: inherit; font-weight: 700; cursor: pointer }
footer { bottom: 16px; left: 16px; right: 16px; width: fit-content; max-width: calc(100% - 32px) }
pre { top: 76px; right: 16px; max-width: calc(100% - 32px); white-space: pre-wrap; font-size: 11px }
#reticle { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
  color: white; font-size: 30px; text-shadow: 0 0 5px #142633; pointer-events: none }
#move:not([hidden]) { position: fixed; bottom: 94px; left: 16px; display: grid;
  grid-template-columns: repeat(3,44px); gap: 4px; touch-action: none; user-select: none }
#move button { width: 44px; height: 44px; padding: 0; touch-action: none }
#move button:first-child { grid-column: 2; grid-row: 1 }
#move button:nth-child(n+2) { grid-row: 2 }
#tools:not([hidden]) { position: fixed; right: 16px; bottom: 94px; display: flex; align-items: center;
  gap: 6px; padding: 4px; border-radius: 10px; background: #fffd }
#tool-name { min-width: 76px; text-align: center; font-weight: 750 }
#loadout { color: #edf5f9; background: #152631; border: 1px solid #55717e;
  border-radius: 14px; max-width: calc(100vw - 24px); padding: 20px }
#loadout::backdrop { background: #12222db8 }
#loadout form { float: right }
.loadout-tools { display: grid; gap: 6px }
.loadout-tools button { text-align: left }
.loadout-tools small { display: block; font-size: 10px; letter-spacing: .09em }
@media (max-width: 500px) {
  header span, header strong { display: none }
  aside { left: 12px; right: auto }
  aside button { padding: 8px 9px }
}
CSS
cat > engine.js <<'ENGINE'
export const SIZE = 32, WIDTH = 64, VOLUME = WIDTH * SIZE * SIZE;
export const CHUNKS = 2, BODIES = 4, QUEUE = 4, SLOTS = 2;
export const STATIC_CAP = 2048 * 6, BODY_CAP = 768 * 6;
export const VERTEX_WORDS = STATIC_CAP * 4;
export const PACKET_BYTES = STATIC_CAP * 40;
export const MAX_RADIUS = 6, STEP = 1 / 60, LIFE = 3;
export const SEED = 0x24f135;

export function local(x, y, z) { return x | (y << 5) | (z << 10); }
export function inside(x, y, z) {
  return (x|0) === x && (y|0) === y && (z|0) === z &&
    x >= 0 && x < WIDTH && y >= 0 && y < SIZE && z >= 0 && z < SIZE;
}
export function cell(x, y, z) { return x + WIDTH * (y + SIZE * z); }

export class World {
  chunks = [new Uint8Array(32768), new Uint8Array(32768)];
  get(x, y, z) {
    return inside(x, y, z) ? this.chunks[x >> 5][local(x & 31, y, z)] : 0;
  }
  put(x, y, z, m) {
    if (inside(x, y, z)) this.chunks[x >> 5][local(x & 31, y, z)] = m;
  }
  clear() { for (const chunk of this.chunks) chunk.fill(0); }
}

export function* seedWorld(world) {
  world.clear();
  let seed = SEED;
  function color() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return 1 + ((seed >>> 0) % 4);
  }
  function* box(x0, x1, y0, y1, z0, z1, material) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) world.put(x, y, z, material);
        yield;
      }
    }
  }
  for (const x of [5, 46]) {
    yield* box(x, x + 12, 0, 0, 6, 17, 5);
    for (const px of [x + 1, x + 10]) {
      for (const pz of [7, 15]) yield* box(px, px + 1, 1, 13, pz, pz + 1, 2);
    }
    for (const y of [6, 12]) yield* box(x, x + 12, y, y, 6, 17, color());
    yield* box(x + 3, x + 9, 13, 13, 9, 14, 1);
    yield* box(x + 5, x + 7, 14, 16, 10, 12, 3);
  }
  yield* box(28, 35, 0, 0, 12, 19, 5);
  yield* box(30, 33, 1, 15, 14, 17, 2);
  yield* box(22, 41, 8, 8, 12, 19, 3);
  yield* box(23, 40, 14, 14, 12, 19, 1);
  yield* box(25, 38, 15, 15, 14, 17, 4);
  yield* box(29, 34, 0, 0, 20, 30, 6);
  for (const x of [20,38]) {
    yield* box(x, x+5, 0, 0, 24, 29, 7);
    const tree = x+2;
    yield* box(tree, tree, 1, 4, 26, 26, 5);
    yield* box(tree-1, tree+1, 4, 6, 25, 27, 7);
    yield* box(tree-2, tree+2, 5, 5, 26, 26, 7);
  }
}

// Slab entry followed by half-open cells. At a tie advance every tied axis.
export function raycast(world, origin, direction, hit, slab, reach = Infinity) {
  let first = 0, last = reach;
  if (!origin || !direction || origin.length !== 3 || direction.length !== 3) return false;
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!Number.isFinite(length) || length === 0) return false;
  for (let axis = 0; axis < 3; axis++) {
    const o = origin[axis], d = direction[axis] / length;
    const limit = axis === 0 ? WIDTH : SIZE;
    if (!Number.isFinite(o) || Math.abs(o) > 1e5) return false;
    if (d === 0) {
      if (o < 0 || o >= limit) return false;
      continue;
    }
    const a = -o / d, b = (limit - o) / d;
    first = Math.max(first, Math.min(a, b));
    last = Math.min(last, Math.max(a, b));
  }
  if (first >= last) return false;
  for (let axis = 0; axis < 3; axis++) {
    const d = direction[axis] / length, o = origin[axis];
    let point = o + first * d;
    const integer = Math.round(point);
    if (Math.abs(point - integer) < 1e-9) point = integer;
    hit[axis] = Math.floor(point) - Number(d < 0 && Number.isInteger(point));
    const boundary = hit[axis] + Number(d > 0);
    slab[axis] = d === 0 ? Infinity : (boundary - o) / d;
  }
  for (let step = 0; step < WIDTH + 2 * SIZE; step++) {
    const [x, y, z] = hit;
    if (!inside(x, y, z)) return false;
    if (world.get(x, y, z)) return true;
    const next = Math.min(slab[0], slab[1], slab[2]);
    if (next >= last) return false;
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(slab[axis] - next) > 1e-9) continue;
      hit[axis] += Math.sign(direction[axis]);
      slab[axis] += length / Math.abs(direction[axis]);
    }
  }
  return false;
}

function dirtyAt(dirty, x) {
  dirty[x >> 5] = 1;
  if (x === 31 || x === 32) dirty[(x >> 5) ^ 1] = 1;
}

export function* blast(world, x, y, z, radius, dirty, chips) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z) ||
      !inside(x, y, z) || !Number.isFinite(radius) || radius <= 0) return 0;
  radius = Math.min(radius, MAX_RADIUS);
  const extent = Math.floor(radius), squared = radius * radius;
  let removed = 0;
  for (let k = Math.max(0, z - extent); k <= Math.min(31, z + extent); k++) {
    for (let j = Math.max(1, y - extent); j <= Math.min(31, y + extent); j++) {
      for (let i = Math.max(0, x - extent); i <= Math.min(63, x + extent); i++) {
        if ((i-x)**2 + (j-y)**2 + (k-z)**2 > squared) continue;
        const material = world.get(i,j,k);
        if (!material) continue;
        chips?.add(i,j,k,material,x,y,z);
        world.put(i,j,k,0);
        dirtyAt(dirty, i);
        removed++;
      }
      yield;
    }
  }
  return removed;
}

export class Connectivity {
  seen = new Uint8Array(VOLUME);
  queue = new Uint32Array(VOLUME);
  island = new World();
  bounds = new Int32Array(6);
  center = new Float64Array(3);
  tail = 0;

  add(world, x, y, z) {
    if (!world.get(x, y, z)) return;
    const index = cell(x, y, z);
    if (this.seen[index]) return;
    this.seen[index] = 1;
    this.queue[this.tail++] = index;
  }

  *flood(world, dirty) {
    const bounds = this.bounds, center = this.center;
    if (dirty) {
      bounds.fill(32, 0, 3);
      bounds[0] = WIDTH;
      bounds.fill(-1, 3);
      center.fill(0);
    }
    for (let head = 0; head < this.tail; head++) {
      const index = this.queue[head];
      const x = index & 63, y = (index >> 6) & 31, z = index >> 11;
      this.add(world,x-1,y,z);
      this.add(world,x+1,y,z);
      this.add(world,x,y-1,z);
      this.add(world,x,y+1,z);
      this.add(world,x,y,z-1);
      this.add(world,x,y,z+1);
      if (dirty) {
        this.island.put(x,y,z,world.get(x,y,z));
        world.put(x,y,z,0);
        dirtyAt(dirty,x);
        bounds[0] = Math.min(bounds[0],x);
        bounds[1] = Math.min(bounds[1],y);
        bounds[2] = Math.min(bounds[2],z);
        bounds[3] = Math.max(bounds[3],x);
        bounds[4] = Math.max(bounds[4],y);
        bounds[5] = Math.max(bounds[5],z);
        center[0] += x + 0.5;
        center[1] += y + 0.5;
        center[2] += z + 0.5;
      }
      if ((head & 127) === 127) yield;
    }
    if (dirty) for (let axis = 0; axis < 3; axis++) center[axis] /= this.tail;
  }

  *detach(world, dirty, present) {
    this.seen.fill(0);
    this.tail = 0;
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < WIDTH; x++) this.add(world,x,0,z);
      yield;
    }
    yield* this.flood(world, null);
    for (let index = 0; index < VOLUME; index++) {
      if ((index & 255) === 0) yield;
      if (this.seen[index]) continue;
      this.tail = 0;
      this.add(world,index & 63,(index >> 6) & 31,index >> 11);
      if (!this.tail) continue;
      yield* this.flood(world, dirty);
      yield* present(this);
      for (let i = 0; i < this.tail; i++) {
        const voxel = this.queue[i];
        this.island.put(voxel & 63,(voxel >> 6) & 31,voxel >> 11,0);
        if ((i & 127) === 127) yield;
      }
    }
  }
}

export function pack(x,y,z,normal,material) {
  return x | (y << 6) | (z << 12) | (normal << 18) | (material << 21);
}
export function unpack(word) {
  return [word & 63,(word >>> 6) & 63,(word >>> 12) & 63,
    (word >>> 18) & 7,(word >>> 21) & 255];
}

export class Mesher {
  mask = new Int16Array(1024);
  point = new Int32Array(3);
  count = 0;

  *mesh(world, section, vertices, indices) {
    const {mask, point} = this, offset = section * SIZE;
    this.count = 0;
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      for (let plane = 0; plane <= SIZE; plane++) {
        for (let j = 0; j < SIZE; j++) {
          point[v] = j;
          for (let i = 0; i < SIZE; i++) {
            point[u] = i;
            point[axis] = plane - 1;
            const a = world.get(point[0]+offset,point[1],point[2]);
            point[axis] = plane;
            const b = world.get(point[0]+offset,point[1],point[2]);
            mask[i + j*SIZE] = a && !b && plane > 0 ? a :
              b && !a && plane < SIZE ? -b : 0;
          }
          yield;
        }
        point[axis] = plane;
        for (let j = 0; j < SIZE; j++) {
          for (let i = 0; i < SIZE;) {
            const start = i + j*SIZE, material = mask[start];
            if (!material) { i++; continue; }
            let width = 1, height = 1;
            while (i+width < SIZE && mask[start+width] === material) width++;
            rows: while (j+height < SIZE) {
              const row = start + height*SIZE;
              for (let k = 0; k < width; k++) if (mask[row+k] !== material) break rows;
              height++;
            }
            for (let row = 0; row < height; row++) {
              const from = start + row*SIZE;
              mask.fill(0,from,from+width);
            }
            const vertex = this.count * 4, index = this.count * 6;
            if (vertex + 4 > vertices.length || index + 6 > indices.length) {
              throw new Error('Mesh capacity invariant violated.');
            }
            const face = 2 * axis + Number(material < 0);
            for (let corner = 0; corner < 4; corner++) {
              point[u] = i + (corner === 1 || corner === 2 ? width : 0);
              point[v] = j + (corner >= 2 ? height : 0);
              vertices[vertex+corner] = pack(point[0],point[1],point[2],face,Math.abs(material));
            }
            indices[index] = vertex;
            indices[index+1] = vertex + (material > 0 ? 1 : 2);
            indices[index+2] = vertex + (material > 0 ? 2 : 1);
            indices[index+3] = vertex;
            indices[index+4] = vertex + (material > 0 ? 2 : 3);
            indices[index+5] = vertex + (material > 0 ? 3 : 2);
            this.count++;
            i += width;
          }
          yield;
        }
      }
    }
    return this.count;
  }
}

export class Bodies {
  state = new Uint8Array(BODIES);
  y = new Float64Array(BODIES);
  floor = new Float64Array(BODIES);
  velocity = new Float64Array(BODIES);
  age = new Float64Array(BODIES);
  center = new Float64Array(BODIES * 3);

  reserve(island) {
    const slot = this.state.indexOf(0);
    if (slot < 0 || island.tail * 6 > BODY_CAP) return -1;
    this.state[slot] = 1;
    this.floor[slot] = -island.bounds[1];
    this.center.set(island.center, slot*3);
    this.y[slot] = this.velocity[slot] = this.age[slot] = 0;
    return slot;
  }
  activate() {
    for (let i = 0; i < BODIES; i++) if (this.state[i] === 1) this.state[i] = 2;
  }
  step() {
    for (let i = 0; i < BODIES; i++) {
      if (this.state[i] !== 2) continue;
      this.velocity[i] -= 9.81 * STEP;
      this.y[i] += this.velocity[i] * STEP;
      if (this.y[i] <= this.floor[i]) {
        this.y[i] = this.floor[i];
        this.velocity[i] = 0;
      }
      this.age[i] += STEP;
      if (this.age[i] >= LIFE) this.state[i] = 0;
    }
  }
}
ENGINE
cat > motion.js <<'MOTION'
import {WIDTH,SIZE,STEP} from './engine.js';

export const CHIP_COUNT = 48, CHIP_STRIDE = 5, CHIP_FLOOR = .53;
export const SPAWN_X = 32, SPAWN_Z = 26, EYE = 1.65;
const RADIUS = .3, SPEED = 5;

export class Walker {
  x = SPAWN_X;
  z = SPAWN_Z;
  feet = 0;

  reset() { this.x = SPAWN_X; this.z = SPAWN_Z; this.feet = 0; }

  solid(world,x,y,z) {
    const loX = Math.floor(x-RADIUS), hiX = Math.floor(x+RADIUS);
    const loZ = Math.floor(z-RADIUS), hiZ = Math.floor(z+RADIUS);
    return world.get(loX,y,loZ) || world.get(hiX,y,loZ) ||
      world.get(loX,y,hiZ) || world.get(hiX,y,hiZ);
  }

  advance(world,x,z) {
    x = Math.min(WIDTH-RADIUS-.001,Math.max(RADIUS,x));
    z = Math.min(SIZE-RADIUS-.001,Math.max(RADIUS,z));
    let y = this.feet;
    if (this.solid(world,x,y,z)) y++;
    if (this.solid(world,x,y,z) || this.solid(world,x,y+1,z)) return;
    while (y > 0 && !this.solid(world,x,y-1,z)) y--;
    this.x = x;
    this.z = z;
    this.feet = y;
  }

  step(world,dx,dz) {
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) return;
    const scale = SPEED * STEP / Math.max(1,Math.hypot(dx,dz));
    this.advance(world,this.x + dx*scale,this.z);
    this.advance(world,this.x,this.z + dz*scale);
  }
}

export class Chips {
  data = new Float32Array(CHIP_COUNT*CHIP_STRIDE);
  snapshot = new Float32Array(CHIP_COUNT*CHIP_STRIDE);
  state = new Uint8Array(CHIP_COUNT);
  vx = new Float32Array(CHIP_COUNT);
  vy = new Float32Array(CHIP_COUNT);
  vz = new Float32Array(CHIP_COUNT);
  spin = new Float32Array(CHIP_COUNT);
  life = new Float32Array(CHIP_COUNT);

  add(x,y,z,material,ox,oy,oz) {
    const slot = this.state.indexOf(0);
    if (slot < 0) return;
    const i = slot*CHIP_STRIDE;
    const dx = x-ox, dy = y-oy, dz = z-oz;
    const kick = 4.5 / Math.max(1,Math.hypot(dx,dy,dz));
    const jitter = ((x*17 + y*31 + z*47) % 13) / 12 - .5;
    this.state[slot] = 1;
    this.data[i] = x+.5;
    this.data[i+1] = y+.5;
    this.data[i+2] = z+.5;
    this.data[i+3] = material;
    this.data[i+4] = jitter;
    this.vx[slot] = dx*kick + jitter*2;
    this.vy[slot] = 3 + dy*kick*.45 + jitter;
    this.vz[slot] = dz*kick - jitter*2;
    this.spin[slot] = 4 + jitter*8;
    this.life[slot] = 2.2 + jitter*.6;
  }

  activate() {
    for (let i = 0; i < CHIP_COUNT; i++) if (this.state[i] === 1) this.state[i] = 2;
  }

  sample(state) {
    for (let slot = 0; slot < CHIP_COUNT; slot++) {
      const i = slot*CHIP_STRIDE;
      for (let k = 0; k < CHIP_STRIDE; k++) {
        this.snapshot[i+k] = this.state[slot] === state ? this.data[i+k] : 0;
      }
    }
    return this.snapshot;
  }

  step(world) {
    for (let slot = 0; slot < CHIP_COUNT; slot++) {
      if (this.state[slot] !== 2) continue;
      if ((this.life[slot] -= STEP) <= 0) { this.state[slot] = 0; continue; }
      const i = slot*CHIP_STRIDE;
      this.vy[slot] -= 9.81*STEP;
      let x = this.data[i], y = this.data[i+1], z = this.data[i+2];
      const nextX = x + this.vx[slot]*STEP, nextZ = z + this.vz[slot]*STEP;
      const xEdge = Math.floor(nextX + Math.sign(this.vx[slot])*.3);
      if (world.get(xEdge,Math.floor(y),Math.floor(z))) this.vx[slot] *= -.35;
      else x = nextX;
      const zEdge = Math.floor(nextZ + Math.sign(this.vz[slot])*.3);
      if (world.get(Math.floor(x),Math.floor(y),zEdge)) this.vz[slot] *= -.35;
      else z = nextZ;
      const nextY = y + this.vy[slot]*STEP;
      const rising = this.vy[slot] > 0;
      const yEdge = Math.floor(nextY + (rising ? .3 : -.3));
      const hitVoxel = world.get(Math.floor(x),yEdge,Math.floor(z));
      const landed = nextY <= CHIP_FLOOR || (hitVoxel && !rising);
      this.data[i+4] += this.spin[slot]*STEP;
      if (landed) {
        y = Math.max(CHIP_FLOOR,hitVoxel ? yEdge+1.3 : 0);
        this.vy[slot] = this.vy[slot] < -1.2 ? -this.vy[slot]*.34 : 0;
        this.vx[slot] *= .80;
        this.vz[slot] *= .80;
        this.spin[slot] *= .78;
      } else if (hitVoxel) this.vy[slot] *= -.25;
      else y = nextY;
      this.data[i] = x;
      this.data[i+1] = y;
      this.data[i+2] = z;
    }
  }
}
MOTION
cat > protocol.js <<'PROTOCOL'
import { PACKET_BYTES, QUEUE, SLOTS } from './engine.js';

export class TransferPool {
  buffers = Array.from({length: SLOTS}, () => new ArrayBuffer(PACKET_BYTES));
  take() { return this.buffers.findIndex(buffer => buffer !== null); }
  lend(slot) {
    const buffer = this.buffers[slot];
    if (!buffer) throw new Error('Transfer slot already lent.');
    this.buffers[slot] = null;
    return buffer;
  }
  recycle(slot, buffer) {
    if (this.buffers[slot] !== null || buffer?.byteLength !== PACKET_BYTES) {
      throw new Error('Invalid transfer return.');
    }
    this.buffers[slot] = buffer;
  }
}

export class Ledger {
  epoch = 0;
  next = 0;
  applied = -1;
  times = new Map();
  reset() {
    this.epoch++;
    this.next = 0;
    this.applied = -1;
    this.times.clear();
  }
  accept(now) {
    if (this.times.size >= QUEUE) return 0;
    const id = ++this.next;
    this.times.set(id, now);
    return id;
  }
  current(message) {
    return message.epoch === this.epoch && message.id > this.applied &&
      (message.id === 0 || this.times.has(message.id));
  }
  finish(id) {
    this.applied = id;
    const time = this.times.get(id);
    this.times.delete(id);
    return time;
  }
}

export class Stage {
  id = -1;
  mask = 0;
  expected = -1;
  chips = null;
  packets = [];
  clear(recycle) {
    for (const packet of this.packets) recycle(packet);
    this.packets.length = 0;
    this.id = -1;
    this.mask = 0;
    this.expected = -1;
    this.chips = null;
  }
  receive(message, ledger, recycle) {
    if (!ledger.current(message)) {
      if (message.type === 'mesh') recycle(message);
      return;
    }
    if (this.id !== -1 && this.id !== message.id) throw new Error('Overlapping revisions.');
    this.id = message.id;
    if (message.type === 'mesh') {
      if (this.packets.length >= SLOTS) throw new Error('Transfer credit exceeded.');
      this.packets.push(message);
    } else {
      this.expected = message.mask;
      this.chips = message.chips;
    }
  }
  ready() { return this.id >= 0 && this.packets.length === 0 && this.mask === this.expected; }
}
PROTOCOL
cat > worker.js <<'WORKER'
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
  if (id === 0) {
    yield* seedWorld(world);
    dirty.fill(1);
  } else if (raycast(world,command.origin,command.direction,hit,slab,
    Number.isFinite(command.reach) ? Math.max(0,Math.min(100,command.reach)) : Infinity)) {
    if (command.rocket) {
      const x = hit[0]+.5, y = hit[1]+.5, z = hit[2]+.5;
      const ms = Math.max(70,Math.hypot(x-command.origin[0],y-command.origin[1],z-command.origin[2])*9);
      postMessage({type:'launch',epoch,id,origin:command.origin,x,y,z,ms});
      yield ms;
    }
    const removed = yield* blast(world,hit[0],hit[1],hit[2],command.radius,dirty,chips);
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
  if (awaiting) postMessage({type:'end',epoch,id,mask,chips:chips.sample(1)});
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
WORKER
cat > bench.js <<'BENCH'
const WARMUP = 10000, DURATION = 600000, SEQUENCE = 6000;
const bins = 1025, precision = 4;
const shots = [[31.5,3.5,5.5],[8.5,6.5,3.8],[52.5,6.5,3.8],
  [15.5,3.5,4.2],[56.5,3.5,4.2],[30.5,11.5,3.5]];

class Histogram {
  data = new Uint32Array(bins);
  count = 0;
  add(value) {
    this.data[Math.min(bins-1,Math.ceil(value*precision))]++;
    this.count++;
  }
  percentile(fraction) {
    if (!this.count) return null;
    const rank = Math.ceil(this.count * fraction);
    let total = 0;
    for (let i = 0; i < bins; i++) {
      total += this.data[i];
      if (total >= rank) return i === bins-1 ? '≥256' : i / precision;
    }
  }
}

export function benchmark(params, output, shoot, reset, memory) {
  const warm = new Histogram(), latency = new Histogram();
  const frames = [new Histogram(),new Histogram(),new Histogram()];
  const qualities = new Uint32Array(3);
  const shotOrigin = new Float64Array([0,0,34]), direction = [0,0,-1];
  const smoke = params.get('bench') === 'smoke';
  const duration = smoke ? 14000 : DURATION;
  let zero = 0, start = 0, sequenceStart = 0, nextShot = 0, lastReport = -Infinity;
  let accepted = 0, dropped = 0, bytes = 0, fragments = 0, terrain = 0, fragmentDraws = 0;
  let auxiliary = 0, baseline, done = false;
  let changed = 0, resets = 0, fell = false;
  output.hidden = false;
  const details = {
    device:params.get('device') || 'unrecorded',
    os:params.get('os') || 'see UA',
    browser:navigator.userAgent,
    displayHz:params.get('hz') || 'unrecorded',
    memory
  };
  function report(now, elapsed, stats) {
    const summary = frames.map(h => [h.percentile(.5),h.percentile(.95),h.percentile(.99)]);
    const count = (stats?.sliceCount || 0) - (baseline?.sliceCount || 0);
    const average = count ? (stats.sliceTotal - (baseline?.sliceTotal || 0))/count : 0;
    const result = {
      ...details, warmFrameMedian:warm.percentile(.5), elapsed,
      frameMsP50P95P99:summary, qualityFrames:Array.from(qualities), accepted,dropped,
      blastVisibleP95:latency.percentile(.95), uploadBytes:bytes,
      draws:{terrain,fragments:fragmentDraws,auxiliary}, activeFragments:fragments,
      workerSliceCount:count, workerSliceMeanMs:average, workerSliceMaxMs:stats?.sliceMax ?? 0,
      queueHigh:stats?.queueHigh ?? 0, omittedIslands:stats?.droppedBodies ?? 0,
      changed,resets,fell,done
    };
    window.benchResult = result;
    output.textContent = [
      `BENCH  ${Math.floor(elapsed/1000)} / ${duration/1000}s`,
      `Frame ms  ${summary[0].join(' / ')}`,
      `Tap p95  ${result.blastVisibleP95 ?? '—'} ms`,
      `Inputs  ${accepted} accepted · ${dropped} dropped`,
      `Draws  ${terrain} terrain · ${fragmentDraws} debris · ${auxiliary} ground`,
      `Debris  ${fragments} active · ${result.omittedIslands} omitted`,
      `Upload  ${bytes} B · queue peak ${result.queueHigh}`,
      `Worker  ${average.toFixed(2)} ms mean · ${result.workerSliceMaxMs.toFixed(2)} max`
    ].join('\n');
    lastReport = now;
    if (done) console.info('Knockout Yard benchmark',result);
  }
  return {
    input(ok) { if (start && !done) { if (ok) accepted++; else dropped++; } },
    upload(n) { if (start && !done) bytes += n; },
    revision(id, ms) {
      if (!id) resets++;
      if (ms !== undefined) { changed++; if (start && !done) latency.add(ms); }
    },
    positions(message) {
      for (let i = 0; i < 4; i++) if (message[i] < -0.05) fell = true;
    },
    frame(now, dt, ready, quality, stats, t, f, a, active) {
      if (done || document.hidden) return;
      if (!zero) { if (!ready) return; zero = now; }
      if (dt > 0 && !start) warm.add(dt);
      const warmTime = smoke ? 1500 : WARMUP;
      if (!start && now-zero >= warmTime) {
        start = now;
        baseline = stats;
        reset();
        ready = false;
        sequenceStart = 0;
        nextShot = 0;
      }
      const elapsed = start ? now-start : 0;
      if (start && elapsed <= duration && dt > 0) {
        frames[0].add(dt);
        if (elapsed < 60000) frames[1].add(dt);
        if (elapsed >= duration-60000) frames[2].add(dt);
        qualities[quality]++;
      }
      terrain = t; fragmentDraws = f; auxiliary = a; fragments = active;
      if (!sequenceStart && ready) sequenceStart = now;
      const phase = sequenceStart ? now-sequenceStart : 0;
      if (start && elapsed >= duration) {
        done = true;
      } else if (phase >= SEQUENCE) {
        reset();
        sequenceStart = 0;
        nextShot = 0;
      } else if (ready) {
        while (nextShot < shots.length && phase >= (nextShot < 3 ? 100 : 900) + nextShot*100) {
          const [x,y,radius] = shots[nextShot++];
          shotOrigin[0] = x;
          shotOrigin[1] = y;
          shoot(shotOrigin,direction,radius);
        }
      }
      if (done || now-lastReport >= 1000) report(now,elapsed,stats);
    }
  };
}
BENCH
cat > walk.js <<'WALK'
import {EYE,SPAWN_X,SPAWN_Z} from './motion.js';

export function walking(canvas,camera,controls,home) {
  const button = document.querySelector('#walk'), move = document.querySelector('#move');
  const reticle = document.querySelector('#reticle'), help = document.querySelector('#help');
  const view = document.querySelector('#view'), tools = document.querySelector('#tools');
  const name = document.querySelector('#tool-name'), menu = document.querySelector('#loadout');
  const loadout = [
    {name:'Sledge',radius:2.5,reach:4,cooldown:1617,animation:1617,equip:1000},
    {name:'Rifle',radius:1,reach:60,cooldown:145,animation:145,equip:0},
    {name:'RPG',radius:5.5,reach:64,cooldown:650,animation:367,equip:0}
  ];
  const keys = new Set(), touches = new Map();
  const movement = new Float64Array(2);
  let yaw, pitch, x, z, feet, phase = 0, stride = 0, swing = -Infinity;
  let selected = 2, third = true, equippedAt = -Infinity;
  function equip(index) {
    const next = (index+loadout.length)%loadout.length;
    if (next !== selected) {
      selected = next;
      equippedAt = performance.now();
      swing = -Infinity;
    }
    name.textContent = loadout[selected].name;
  }
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
      yaw = pitch = feet = 0;
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
      if (/^Digit[123]$/.test(event.code)) equip(Number(event.code.at(-1))-1);
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
WALK
cat > main.js <<'MAIN'
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {
  BODIES, CHUNKS, VOLUME, SLOTS, STATIC_CAP, BODY_CAP, PACKET_BYTES, VERTEX_WORDS, pack
} from './engine.js';
import {Ledger,Stage} from './protocol.js';
import {benchmark} from './bench.js';
import {CHIP_COUNT,CHIP_STRIDE} from './motion.js';
import {walking} from './walk.js';

const canvas = document.querySelector('canvas'), status = document.querySelector('#status');
const button = document.querySelector('#reset'), metrics = document.querySelector('#metrics');
const params = new URLSearchParams(location.search);
let failed = false, worker;
function fail(message) {
  failed = true;
  worker?.terminate();
  status.textContent = message;
  button.disabled = true;
  document.querySelector('#walk').disabled = true;
}

try { start(); }
catch (error) { fail(error.message); console.error(error); }

function start() {
  const gl = canvas.getContext('webgl2',{alpha:false,antialias:false,stencil:false});
  if (!gl) throw new Error('WebGL 2 is unavailable. Open this yard in a browser with WebGL 2 enabled.');
  canvas.addEventListener('webglcontextlost',event => {
    event.preventDefault();
    fail('The graphics context was lost. Reload to reopen the yard.');
  });
  const renderer = new T.WebGLRenderer({canvas,context:gl});
  renderer.debug.onShaderError = (context,program,vs,fs) => {
    console.error(context.getProgramInfoLog(program),context.getShaderInfoLog(vs),context.getShaderInfoLog(fs));
    throw new Error('The voxel shader could not compile. Reload or try another WebGL 2 browser.');
  };
  const scene = new T.Scene();
  scene.background = new T.Color('#b9e5fc');
  const camera = new T.PerspectiveCamera(44,1,0.15,220);
  const controls = new OrbitControls(camera,canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minDistance = 13;
  controls.maxDistance = 120;
  controls.maxPolarAngle = Math.PI * .485;
  function home() {
    controls.target.set(32,6,13);
    camera.position.set(65,38,68);
    controls.update();
  }
  home();
  const walk = walking(canvas,camera,controls,home);

  const material = new T.RawShaderMaterial({
    glslVersion:T.GLSL3,
    uniforms:{palette:{value:['#293940','#ffc736','#17b7b3','#ff6b47',
      '#f2f5ee','#607584','#9bb0ae','#70aa5d'].map(color => new T.Color(color))}},
    vertexShader:`
      precision highp float;
      precision highp int;
      uniform mat4 projectionMatrix;
      uniform mat4 modelViewMatrix;
      in uint packedVoxel;
      #ifdef CHIP_INSTANCES
      in mat4 instanceMatrix;
      in float chipMaterial;
      #endif
      flat out uint materialId;
      flat out float shade;
      void main() {
        uint axis = (packedVoxel >> 18u) & 7u;
        vec3 p = vec3(packedVoxel & 63u, (packedVoxel >> 6u) & 63u, (packedVoxel >> 12u) & 63u);
        vec3 normal = axis < 2u ? vec3(1,0,0) : axis < 4u ? vec3(0,1,0) : vec3(0,0,1);
        if ((axis & 1u) != 0u) normal = -normal;
        shade = 0.63 + 0.37 * max(0.0, dot(normal,normalize(vec3(0.5,0.9,0.6))));
        materialId = (packedVoxel >> 21u) & 255u;
        #ifdef CHIP_INSTANCES
        materialId = uint(chipMaterial);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p - 0.5,1.0);
        #else
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
        #endif
      }`,
    fragmentShader:`
      precision highp float;
      precision highp int;
      uniform vec3 palette[8];
      flat in uint materialId;
      flat in float shade;
      out vec4 pixel;
      void main() {
        vec3 linear = palette[int(materialId & 7u)] * shade;
        vec3 rgb = mix(12.92 * linear,1.055 * pow(linear,vec3(1.0/2.4))-0.055,
                       step(vec3(0.0031308),linear));
        pixel = vec4(rgb,1.0);
      }`
  });
  const ledger = new Ledger(), stage = new Stage();
  const terrain = [], debris = [], shown = new Uint8Array(CHUNKS);
  const currentY = new Float32Array(BODIES), previousY = new Float32Array(BODIES);
  const visible = new Uint8Array(BODIES);
  const mixStart = new Float64Array(BODIES);
  const draws = new Uint8Array(3);

  function makeMesh(cap, section, category) {
    const geometry = new T.BufferGeometry();
    const vertices = new T.BufferAttribute(new Uint32Array(cap*4),1).setUsage(T.DynamicDrawUsage);
    const indices = new T.BufferAttribute(new Uint32Array(cap*6),1).setUsage(T.DynamicDrawUsage);
    vertices.gpuType = T.IntType;
    geometry.setAttribute('packedVoxel',vertices);
    geometry.setIndex(indices);
    geometry.boundingBox = new T.Box3(new T.Vector3(0,0,0),new T.Vector3(32,32,32));
    geometry.boundingSphere = new T.Sphere(new T.Vector3(16,16,16),Math.sqrt(3)*16);
    geometry.setDrawRange(0,0);
    const mesh = new T.Mesh(geometry,material);
    mesh.position.x = section*32;
    mesh.frustumCulled = false;
    mesh.onAfterRender = () => { if (geometry.drawRange.count) draws[category]++; };
    scene.add(mesh);
    return {mesh,geometry,vertices,indices,count:0};
  }
  for (let section = 0; section < CHUNKS; section++) {
    terrain.push([makeMesh(STATIC_CAP,section,0),makeMesh(STATIC_CAP,section,0)]);
  }
  for (let slot = 0; slot < BODIES; slot++) {
    for (let section = 0; section < CHUNKS; section++) debris.push(makeMesh(BODY_CAP,section,1));
  }
  const ground = makeMesh(1,0,2);
  ground.vertices.array.set([pack(0,0,0,2,6),pack(0,0,32,2,6),pack(32,0,32,2,6),pack(32,0,0,2,6)]);
  ground.indices.array.set([0,1,2,0,2,3]);
  ground.mesh.position.set(-18,-.01,-12);
  ground.mesh.scale.set(3.125,1,1.875);
  ground.geometry.setDrawRange(0,6);

  const cube = new T.BoxGeometry(1,1,1);
  const p = cube.getAttribute('position'), n = cube.getAttribute('normal');
  const packed = new Uint32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const nx = n.getX(i), ny = n.getY(i);
    const face = nx ? Number(nx < 0) : ny ? 2 + Number(ny < 0) : 4 + Number(n.getZ(i) < 0);
    packed[i] = pack(p.getX(i)+.5,p.getY(i)+.5,p.getZ(i)+.5,face,1);
  }
  const chipGeometry = new T.BufferGeometry();
  chipGeometry.setAttribute('packedVoxel',new T.BufferAttribute(packed,1));
  chipGeometry.setIndex(new T.BufferAttribute(Uint32Array.from(cube.index.array),1));
  const chipMaterialId = new T.InstancedBufferAttribute(new Float32Array(CHIP_COUNT),1);
  chipMaterialId.setUsage(T.DynamicDrawUsage);
  chipGeometry.setAttribute('chipMaterial',chipMaterialId);
  const chipMaterial = material.clone();
  chipMaterial.defines.CHIP_INSTANCES = 1;
  const chips = new T.InstancedMesh(chipGeometry,chipMaterial,CHIP_COUNT);
  chips.instanceMatrix.setUsage(T.DynamicDrawUsage);
  chips.frustumCulled = false;
  chips.onAfterRender = () => { if (chips.count) draws[1]++; };
  const chipData = new Float32Array(CHIP_COUNT*CHIP_STRIDE);
  const chipTransform = new T.Object3D();
  chipTransform.scale.setScalar(.6);
  chipTransform.position.y = -100;
  chipTransform.updateMatrix();
  chips.setMatrixAt(0,chipTransform.matrix);
  chips.count = 1;
  scene.add(chips);

  const actorGeometry = chipGeometry.clone();
  const actorColors = actorGeometry.getAttribute('chipMaterial');
  const actor = new T.InstancedMesh(actorGeometry,chipMaterial,9);
  actor.instanceMatrix.setUsage(T.DynamicDrawUsage);
  actor.frustumCulled = false;
  actor.count = 1;
  actor.setMatrixAt(0,chipTransform.matrix);
  actor.onAfterRender = () => { if (actor.count) draws[2]++; };
  scene.add(actor);
  const root = new T.Object3D(), part = new T.Object3D(), matrix = new T.Matrix4();
  const rocketFrom = new T.Vector3(), rocketTo = new T.Vector3();
  let rocket = null, actorCount = 0;
  function box(x,y,z,sx,sy,sz,color,angle = 0) {
    part.position.set(x,y,z);
    part.scale.set(sx,sy,sz);
    part.rotation.x = angle;
    part.updateMatrix();
    matrix.multiplyMatrices(root.matrix,part.matrix);
    actor.setMatrixAt(actorCount,matrix);
    actorColors.array[actorCount++] = color;
  }
  function showActor(now) {
    actorCount = 0;
    if (walk.thirdPerson) {
      const gait = walk.gait, action = walk.action(now);
      const equip = walk.equipping(now);
      const swing = walk.tool === 0 ? Math.sin(action*Math.PI)*1.8 + Math.sin(equip*Math.PI)*.8 :
        action*action*.45;
      root.position.set(walk.x,walk.feet+Math.abs(gait)*.055,walk.z);
      root.rotation.y = walk.yaw;
      root.updateMatrix();
      box(0,1.77,0,.45,.44,.43,4);
      box(0,1.99,0,.56,.12,.53,1);
      box(0,1.26,0,.67,.57,.37,2);
      box(-.45,1.24,gait*.11,.21,.51,.24,4,gait*.65);
      box(.45,1.24,-gait*.11-swing*.13,.21,.51,.24,4,-gait*.65-swing);
      box(-.17,.46,-gait*.19,.28,.85,.31,5,-gait*.63);
      box(.17,.46,gait*.19,.28,.85,.31,5,gait*.63);
      if (walk.tool === 0) box(.51,1.39+swing*.36,-.28,.22,.53,.34,1,-swing);
      else box(.51,1.22,-.39+action*.12,.20,.23,walk.tool === 1 ? .63 : .82,3);
    }
    if (rocket) {
      const t = Math.min(1,(now-rocket.start)/rocket.ms);
      root.position.lerpVectors(rocketFrom,rocketTo,Math.max(0,t));
      root.rotation.set(0,0,0);
      root.updateMatrix();
      box(0,0,0,.19,.19,.19,3);
      if (t >= 1) rocket = null;
    }
    actor.count = actorCount;
    actor.visible = Boolean(actorCount);
    if (actorCount) {
      actor.instanceMatrix.addUpdateRange(0,actorCount*16);
      actorColors.addUpdateRange(0,actorCount);
      actor.instanceMatrix.needsUpdate = actorColors.needsUpdate = true;
    }
  }

  function showChips() {
    let count = 0;
    for (let i = 0; i < chipData.length; i += CHIP_STRIDE) {
      if (!chipData[i+3]) continue;
      chipTransform.position.set(chipData[i],chipData[i+1],chipData[i+2]);
      chipTransform.rotation.set(chipData[i+4],chipData[i+4]*.73,chipData[i+4]*.39);
      chipTransform.updateMatrix();
      chips.setMatrixAt(count,chipTransform.matrix);
      chipMaterialId.array[count++] = chipData[i+3];
    }
    chips.visible = Boolean(count);
    chips.count = count;
    if (!count) return;
    chips.instanceMatrix.clearUpdateRanges();
    chipMaterialId.clearUpdateRanges();
    chips.instanceMatrix.addUpdateRange(0,count*16);
    chipMaterialId.addUpdateRange(0,count);
    chips.instanceMatrix.needsUpdate = chipMaterialId.needsUpdate = true;
  }

  const scales = [.50,.66,.82];
  let quality = 0, windowFrames = 0, slow = 0, good = 0;
  function resize() {
    const width = Math.max(1,canvas.clientWidth), height = Math.max(1,canvas.clientHeight);
    const scale = Math.min(scales[quality],1280/width,900/height);
    renderer.setSize(Math.max(1,Math.floor(width*scale)),Math.max(1,Math.floor(height*scale)),false);
    camera.aspect = width/height;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize',resize);
  resize();
  renderer.compile(scene,camera);
  renderer.render(scene,camera);
  chips.visible = false;
  actor.visible = false;
  if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL 2 failed to initialize the voxel renderer.');
  for (const pair of terrain) for (const entry of pair) entry.mesh.visible = false;
  for (const entry of debris) entry.mesh.visible = false;

  try { worker = new Worker(new URL('./worker.js',import.meta.url),{type:'module'}); }
  catch { throw new Error('The module worker could not start. Serve the project over HTTP and reload.'); }
  worker.onerror = event => fail(`The voxel worker stopped. Reload the yard. ${event.message || ''}`);
  worker.onmessageerror = () => fail('The browser could not read a worker message. Reload the yard.');
  let ready = false, tickPending = false, stats, previousFrame = 0;
  let needsDrawCheck = true;
  const renderBytes = (CHUNKS*2*STATIC_CAP + CHUNKS*BODIES*BODY_CAP + 1)*40;
  const tracked = {
    renderCpuBytes:renderBytes, gpuMeshCapacityBytes:renderBytes,
    workerAndTransferBytes:7*VOLUME + SLOTS*PACKET_BYTES + 4096 + CHIP_COUNT*61,
    chipCpuGpuBytes:2*(CHIP_COUNT*68 + packed.byteLength + chipGeometry.index.array.byteLength) +
      chipData.byteLength,
    actorCpuGpuBytes:2*(9*64 + actorColors.array.byteLength + packed.byteLength +
      chipGeometry.index.array.byteLength),
    telemetryHistogramBytes:params.has('bench') ? 5*1025*4 : 0
  };
  const bench = params.has('bench') ? benchmark(params,metrics,shoot,reset,tracked) : null;
  const recycle = ({slot,buffer}) => worker.postMessage({type:'recycle',slot,buffer},[buffer]);

  function hideBody(slot) {
    visible[slot] = 0;
    for (let s = 0; s < CHUNKS; s++) {
      const entry = debris[slot*CHUNKS+s];
      entry.mesh.visible = false;
      entry.geometry.setDrawRange(0,0);
    }
  }
  function interpolate(slot, now) {
    const alpha = Math.min(1,Math.max(0,(now-mixStart[slot])/16.667));
    return previousY[slot] + (currentY[slot]-previousY[slot])*alpha;
  }
  worker.onmessage = ({data:m}) => {
    try {
      if (m.type === 'pose') {
        tickPending = false;
        if (m.epoch !== ledger.epoch) return;
        stats = m;
        if (m.id !== ledger.applied || !ready) return;
        walk.pose(m);
        chipData.set(m.chips);
        showChips();
        bench?.positions(m);
        const now = performance.now();
        for (let slot = 0; slot < BODIES; slot++) {
          if (!visible[slot]) continue;
          if (m[slot] === null) hideBody(slot);
          else {
            previousY[slot] = interpolate(slot,now);
            currentY[slot] = m[slot];
            mixStart[slot] = now;
          }
        }
      } else if (m.type === 'launch') {
        if (!ledger.current(m)) return;
        rocket = {start:performance.now(),ms:m.ms};
        rocketFrom.fromArray(m.origin);
        rocketTo.set(m.x,m.y,m.z);
      } else stage.receive(m,ledger,recycle);
    } catch (error) { fail(error.message); console.error(error); }
  };

  function shoot(origin,direction,radius,reach,rocket) {
    const id = ready && !failed ? ledger.accept(performance.now()) : 0;
    bench?.input(Boolean(id));
    if (id) worker.postMessage({type:'blast',epoch:ledger.epoch,id,origin,direction,radius,reach,rocket});
  }
  function reset() {
    if (failed) return;
    ready = false;
    button.disabled = true;
    walk.ready(false);
    walk.reset();
    rocket = null;
    status.textContent = 'Preparing a fresh yard…';
    ledger.reset();
    stage.clear(recycle);
    for (const pair of terrain) {
      for (const entry of pair) if (!entry.geometry.drawRange.count) entry.mesh.visible = false;
    }
    for (let slot = 0; slot < BODIES; slot++) {
      if (!visible[slot]) hideBody(slot);
    }
    if (bench) home();
    worker.postMessage({type:'reset',epoch:ledger.epoch});
  }
  button.addEventListener('click',reset);

  const ray = new T.Raycaster(), ndc = new T.Vector2();
  let pointer = null, downX = 0, downY = 0, tap = false, downTime = 0;
  let lastX = 0, lastY = 0;
  const pointers = new Set();
  canvas.addEventListener('pointerdown',event => {
    pointers.add(event.pointerId);
    if (pointers.size === 1 && event.button === 0) {
      pointer = event.pointerId;
      downX = event.clientX;
      downY = event.clientY;
      lastX = downX;
      lastY = downY;
      if (walk.active) canvas.setPointerCapture(event.pointerId);
      downTime = performance.now();
      tap = true;
    } else tap = false;
  });
  function moved(event) {
    return (event.clientX-downX)**2 + (event.clientY-downY)**2 > 64;
  }
  canvas.addEventListener('pointermove',event => {
    if (event.pointerId !== pointer || !pointers.has(pointer)) return;
    if (moved(event)) tap = false;
    if (walk.active && !tap && pointers.size === 1) {
      walk.look(event.clientX-lastX,event.clientY-lastY);
    }
    lastX = event.clientX;
    lastY = event.clientY;
  });
  canvas.addEventListener('pointerup',event => {
    pointers.delete(event.pointerId);
    if (event.pointerId !== pointer || !tap || moved(event) || performance.now()-downTime > 450) return;
    tap = false;
    const rect = canvas.getBoundingClientRect();
    ndc.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
    if (walk.active) {
      const tool = walk.attack(ray.ray,performance.now());
      if (tool) shoot(ray.ray.origin.toArray(),ray.ray.direction.toArray(),tool.radius,tool.reach,walk.tool === 2);
      return;
    }
    ray.setFromCamera(ndc,camera);
    shoot(ray.ray.origin.toArray(),ray.ray.direction.toArray(),4.75);
  });
  for (const type of ['pointercancel','lostpointercapture']) {
    canvas.addEventListener(type,event => {
      pointers.delete(event.pointerId);
      if (event.pointerId === pointer) tap = false;
    });
  }

  document.addEventListener('visibilitychange',() => {
    if (failed) return;
    previousFrame = 0;
    windowFrames = slow = good = 0;
    worker.postMessage({type:'pause',epoch:ledger.epoch});
    if (document.hidden && bench) fail('Benchmark interrupted by a hidden tab. Reload to run again.');
  });

  function stageMesh(packet) {
    const {target,quads,buffer} = packet;
    let entry;
    if (target < CHUNKS) entry = terrain[target][shown[target]^1];
    else {
      const index = target-CHUNKS, slot = Math.floor(index/CHUNKS);
      if (!(stage.mask & (3 << (CHUNKS + slot*CHUNKS)))) hideBody(slot);
      entry = debris[index];
    }
    const v = quads*4, i = quads*6;
    if (v > entry.vertices.count || i > entry.indices.count) throw new Error('Mesh exceeds render storage.');
    entry.count = i;
    if (i) {
      entry.vertices.array.set(new Uint32Array(buffer,0,v));
      entry.indices.array.set(new Uint32Array(buffer,VERTEX_WORDS*4,i));
      entry.vertices.addUpdateRange(0,v);
      entry.indices.addUpdateRange(0,i);
      entry.vertices.needsUpdate = entry.indices.needsUpdate = true;
    }
    entry.mesh.visible = Boolean(i);
    entry.mesh.frustumCulled = false;
    entry.geometry.setDrawRange(0,0);
    stage.mask |= 1 << target;
    bench?.upload((v+i)*4);
  }

  function show(entry) {
    entry.mesh.visible = Boolean(entry.count);
    entry.mesh.frustumCulled = true;
    entry.geometry.setDrawRange(0,entry.count);
  }
  function publish(now) {
    if (stage.id === 0) {
      for (let slot = 0; slot < BODIES; slot++) hideBody(slot);
      chipData.fill(0);
    }
    for (let i = 0; i < chipData.length; i += CHIP_STRIDE) {
      if (stage.chips?.[i+3]) {
        for (let k = 0; k < CHIP_STRIDE; k++) chipData[i+k] = stage.chips[i+k];
      }
    }
    showChips();
    for (let s = 0; s < CHUNKS; s++) {
      if (!(stage.mask & (1 << s))) continue;
      const old = terrain[s][shown[s]];
      old.mesh.visible = false;
      old.geometry.setDrawRange(0,0);
      shown[s] ^= 1;
      show(terrain[s][shown[s]]);
    }
    for (let i = 0; i < debris.length; i++) {
      if (!(stage.mask & (1 << (CHUNKS+i)))) continue;
      const slot = Math.floor(i/CHUNKS);
      visible[slot] = 1;
      previousY[slot] = currentY[slot] = 0;
      mixStart[slot] = now;
      show(debris[i]);
    }
  }

  function frame(now) {
    if (failed) return;
    try {
      const dt = previousFrame ? now-previousFrame : 0;
      previousFrame = now;
      if (dt > 0) {
        if (dt > 20) slow++;
        if (++windowFrames === 120) {
          const before = quality;
          if (slow >= 15) { quality = Math.max(0,quality-1); good = 0; }
          else if (slow <= 2 && ++good === 4) { quality = Math.min(2,quality+1); good = 0; }
          else if (slow > 2) good = 0;
          if (quality !== before) resize();
          windowFrames = slow = 0;
        }
      }
      if (walk.active) walk.aim(); else controls.update();
      showActor(now);
      const packet = stage.packets.shift();
      if (packet) stageMesh(packet);
      const commit = stage.ready();
      if (commit) publish(now);
      let active = 0;
      for (let slot = 0; slot < BODIES; slot++) {
        if (!visible[slot]) continue;
        active++;
        const y = interpolate(slot,now);
        for (let s = 0; s < CHUNKS; s++) debris[slot*CHUNKS+s].mesh.position.y = y;
      }
      draws.fill(0);
      renderer.render(scene,camera);
      if (packet) recycle(packet);
      if (commit) {
        if (needsDrawCheck) {
          needsDrawCheck = false;
          if (gl.getError() !== gl.NO_ERROR || draws[0] === 0) throw new Error('The voxel terrain could not render.');
        }
        const revision = stage.id, changed = stage.mask !== 0;
        const acceptedAt = ledger.finish(revision);
        bench?.revision(revision,changed && acceptedAt !== undefined ? performance.now()-acceptedAt : undefined);
        stage.clear(recycle);
        worker.postMessage({type:'activate',epoch:ledger.epoch,id:revision});
        if (revision === 0) {
          ready = true;
          button.disabled = false;
          walk.ready(!bench);
          status.textContent = 'Yard open';
        }
      }
      if (!tickPending && !document.hidden) {
        tickPending = true;
        const direction = walk.movement();
        worker.postMessage({type:'tick',epoch:ledger.epoch,dx:ready ? direction[0] : 0,
          dz:ready ? direction[1] : 0});
      }
      bench?.frame(now,dt,ready,quality,stats,draws[0],draws[1],draws[2],active);
      requestAnimationFrame(frame);
    } catch (error) { fail(error.message); console.error(error); }
  }
  reset();
  setTimeout(() => {
    if (!failed && ledger.applied < 0 && ledger.epoch === 1) {
      fail('The worker did not finish starting. Reload the yard or try another browser.');
    }
  },10000);
  requestAnimationFrame(frame);
}
MAIN
cat > engine.test.js <<'TEST'
import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {
  World, Connectivity, Mesher, Bodies, seedWorld, blast, raycast, local, pack, unpack,
  STATIC_CAP, PACKET_BYTES, QUEUE
} from './engine.js';
import {Ledger,Stage,TransferPool} from './protocol.js';
import {Walker,Chips,CHIP_COUNT,CHIP_FLOOR} from './motion.js';

function run(generator) {
  let next;
  do { next = generator.next(); } while (!next.done);
  return next.value;
}
function total(world) {
  return world.chunks.reduce((sum,chunk) => chunk.reduce((n,m) => n + Number(m !== 0),sum),0);
}

test('world addressing, inclusive sphere, radius cap, and immutable anchors', () => {
  const world = new World(), dirty = new Uint8Array(2);
  assert.equal(local(31,31,31),32767);
  world.put(31,31,31,2);
  world.put(32,0,0,3);
  world.put(63,31,31,4);
  assert.equal(world.chunks[0][32767],2);
  assert.equal(world.chunks[1][0],3);
  assert.equal(world.get(63,31,31),4);
  for (const p of [[64,0,0],[-1,0,0],[32,32,0],[32,0,32],[32,0,.5]]) {
    world.put(...p,255);
    assert.equal(world.get(...p),0);
  }
  for (const p of [[32,1,0],[33,1,0],[33,2,0],[38,1,0],[39,1,0]]) world.put(...p,2);
  assert.equal(run(blast(world,32,1,0,1,dirty)),2);
  assert.deepEqual([...dirty],[1,1]);
  assert.equal(world.get(32,0,0),3);
  assert.equal(world.get(33,2,0),2);
  assert.equal(run(blast(world,32,1,0,NaN,dirty)),0);
  assert.equal(run(blast(world,32,1,0,1e4,dirty)),2);
  assert.equal(world.get(39,1,0),2);
});

test('DDA slab entry, boundary direction, parallel exclusion and corner tie', () => {
  const world = new World(), hit = new Int32Array(3), slab = new Float64Array(3);
  world.put(32,2,3,1);
  world.put(63,2,3,2);
  world.put(31,2,3,3);
  for (const [origin,direction,want] of [
    [[-1,2,3],[1,0,0],[31,2,3]], [[64,2,3],[-1,0,0],[63,2,3]],
    [[32,2,3],[-1,0,0],[31,2,3]], [[32,2,3],[1,0,0],[32,2,3]]
  ]) {
    assert.ok(raycast(world,origin,direction,hit,slab));
    assert.deepEqual([...hit],want);
  }
  world.clear();
  world.put(1,0,0,2);
  world.put(1,1,0,2);
  assert.ok(raycast(world,[.5,.5,.5],[1,1,0],hit,slab));
  assert.deepEqual([...hit],[1,1,0]);
  assert.equal(raycast(world,[-1,32,0],[1,0,0],hit,slab),false);
  assert.equal(raycast(world,[0,0,0],[0,0,0],hit,slab),false);
  assert.equal(raycast(world,[-1,.5,.5],[1,0,0],hit,slab,1.5),false);
  assert.equal(raycast(world,[-1,.5,.5],[1,0,0],hit,slab,2.5),true);
});

test('cross-chunk support, separated islands, conservation, and ground impact', () => {
  const world = new World(), connectivity = new Connectivity(), bodies = new Bodies();
  const dirty = new Uint8Array(2), islands = [];
  for (const [x,y,z] of [[31,0,4],[31,1,4],[31,2,4],[32,2,4],[33,2,4],
    [31,0,6],[31,1,6],[31,2,6],[32,2,6],[30,0,2],[31,1,2]]) world.put(x,y,z,1);
  function* capture(island) {
    assert.equal(total(island.island),island.tail);
    islands.push({size:island.tail,bounds:[...island.bounds],center:[...island.center]});
    bodies.reserve(island);
  }
  run(connectivity.detach(world,dirty,capture));
  assert.equal(islands.length,1);
  assert.equal(islands[0].size,1);
  assert.equal(world.get(33,2,4),1);
  const before = total(world);
  const removed = run(blast(world,31,1,5,1,dirty));
  run(connectivity.detach(world,dirty,capture));
  assert.equal(removed,2);
  assert.deepEqual(islands[1],{size:3,bounds:[31,2,4,33,2,4],center:[32.5,2.5,4.5]});
  assert.equal(islands[2].size,2);
  assert.equal(before,removed+total(world)+islands[1].size+islands[2].size);
  bodies.activate();
  for (let i = 0; i < 120; i++) {
    bodies.step();
    assert.ok(bodies.y[1] >= -2);
  }
  assert.equal(bodies.y[1],-2);
  assert.equal(bodies.velocity[1],0);
  for (let i = 0; i < 70; i++) bodies.step();
  assert.equal(bodies.state[1],0);
});

test('overflow omits excess island visuals while extracting every voxel', () => {
  const world = new World(), connectivity = new Connectivity(), bodies = new Bodies();
  const dirty = new Uint8Array(2), slots = [];
  for (let x = 0; x < 12; x += 2) world.put(x,3,0,1);
  run(connectivity.detach(world,dirty,function* (island) { slots.push(bodies.reserve(island)); }));
  assert.deepEqual(slots,[0,1,2,3,-1,-1]);
  assert.equal(total(world),0);
});

test('walker steps onto a low block and stops at a wall until it is blasted', () => {
  const world = new World(), walk = new Walker(), dirty = new Uint8Array(2);
  for (const x of [31,32]) {
    world.put(x,0,24,1);
    for (let y = 0; y < 4; y++) world.put(x,y,23,1);
  }
  for (let i = 0; i < 60; i++) walk.step(world,0,-1);
  assert.equal(walk.feet,1);
  assert.ok(walk.z >= 24.3);
  for (const x of [31,32]) run(blast(world,x,2,23,1,dirty));
  for (let i = 0; i < 30; i++) walk.step(world,0,-1);
  assert.ok(walk.z < 23);
  assert.equal(walk.feet,0);
});

test('blast chips stage at the original voxel, bounce, and recycle without protecting terrain', () => {
  const world = new World(), chips = new Chips(), dirty = new Uint8Array(2);
  world.put(10,3,10,4);
  assert.equal(run(blast(world,10,3,10,1,dirty,chips)),1);
  assert.deepEqual([...chips.sample(1).slice(0,4)],[10.5,3.5,10.5,4]);
  assert.equal(chips.sample(2)[3],0);
  for (let i = 1; i < CHIP_COUNT; i++) chips.add(10,3,10,4,10,3,10);
  world.put(11,3,10,2);
  assert.equal(run(blast(world,11,3,10,1,dirty,chips)),1);
  assert.equal(world.get(11,3,10),0);
  chips.activate();
  let bounced = false;
  for (let step = 0; step < 180; step++) {
    chips.step(world);
    if (chips.state[0] === 2) assert.ok(chips.data[1] >= CHIP_FLOOR-1e-6);
    if (Math.abs(chips.data[1]-CHIP_FLOOR) < 1e-6 && chips.vy[0] > 0) bounced = true;
  }
  assert.ok(bounced);
  assert.equal(chips.state.indexOf(2),-1);
});

test('greedy masks, material splits, empty mesh, packing and six windings', () => {
  const world = new World(), mesher = new Mesher();
  const vertices = new Uint32Array(256), indices = new Uint32Array(384);
  const mesh = () => run(mesher.mesh(world,0,vertices,indices));
  assert.equal(mesh(),0);
  world.chunks[0].fill(1);
  assert.equal(mesh(),6);
  const normals = new Set();
  for (let n = 0; n < 6; n++) {
    const [a,b,c] = indices.slice(n*6,n*6+3).map(x => vertices[x]);
    const p = unpack(a), q = unpack(b), r = unpack(c), face = p[3];
    const u = (Math.floor(face/2)+1)%3, v = (u+1)%3;
    const sign = (q[u]-p[u])*(r[v]-p[v]) - (q[v]-p[v])*(r[u]-p[u]);
    assert.equal(Math.sign(sign),face%2 ? -1 : 1);
    assert.deepEqual(unpack(pack(32,32,32,face,255)),[32,32,32,face,255]);
    normals.add(face);
  }
  assert.equal(normals.size,6);
  world.chunks[1].fill(1);
  assert.equal(mesh(),5);
  world.clear();
  world.put(0,0,0,1);
  world.put(1,0,0,1);
  assert.equal(mesh(),6);
  world.put(1,0,0,2);
  assert.equal(mesh(),10);
});

test('checkerboard needs 32-bit indices and fails explicitly with inadequate capacity', () => {
  const world = new World(), mesher = new Mesher(), quads = 16384*6;
  for (let z = 0; z < 32; z++) for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) if ((x+y+z)%2 === 0) world.put(x,y,z,1);
  }
  assert.throws(() => run(mesher.mesh(world,0,new Uint32Array(16),new Uint32Array(24))),/capacity/);
  const vertices = new Uint32Array(quads*4), indices = new Uint32Array(quads*6);
  assert.equal(run(mesher.mesh(world,0,vertices,indices)),quads);
  assert.equal(indices.at(-1),quads*4-1);
  run(seedWorld(world));
  for (const chunk of world.chunks) assert.ok(chunk.filter(Boolean).length * 6 <= STATIC_CAP);
});

test('credit saturation, detached ownership, atomic stage, and stale return', () => {
  const pool = new TransferPool(), ledger = new Ledger(), stage = new Stage();
  ledger.reset();
  for (let i = 0; i < QUEUE; i++) assert.equal(ledger.accept(i),i+1);
  assert.equal(ledger.accept(5),0);
  function packet(target) {
    const slot = pool.take(), buffer = pool.lend(slot);
    const transferred = structuredClone(buffer,{transfer:[buffer]});
    assert.equal(buffer.byteLength,0);
    return {type:'mesh',epoch:1,id:1,target,slot,buffer:transferred};
  }
  function recycle({slot,buffer}) {
    pool.recycle(slot,structuredClone(buffer,{transfer:[buffer]}));
  }
  stage.receive(packet(0),ledger,recycle);
  const late = packet(1);
  assert.equal(pool.take(),-1);
  assert.equal(late.buffer.byteLength,PACKET_BYTES);
  stage.receive({type:'end',epoch:1,id:1,mask:3},ledger,recycle);
  assert.equal(stage.ready(),false);
  recycle(stage.packets.shift());
  stage.mask = 1;
  assert.equal(stage.ready(),false);
  ledger.reset();
  stage.clear(recycle);
  stage.receive(late,ledger,recycle);
  assert.equal(late.buffer.byteLength,0);
  assert.equal(stage.ready(),false);
  assert.ok(pool.take() >= 0);
});

test('real worker drains queued blasts in order and restores identical seed after reset', {timeout:10000}, async t => {
  const url = new URL('./worker.js',import.meta.url).href;
  const adapter = `
    import {parentPort} from 'node:worker_threads';
    globalThis.self = globalThis;
    globalThis.postMessage = (data, transfer) => parentPort.postMessage(data,transfer);
    await import(${JSON.stringify(url)});
    parentPort.on('message',data => globalThis.onmessage({data}));
  `;
  const worker = new Worker(new URL('data:text/javascript,'+encodeURIComponent(adapter)));
  t.after(() => worker.terminate());
  let seedMask = 0, blastMask = 0, epoch = 1;
  let launched = false;
  const order = [], seed = [], held = [];
  await new Promise((resolve,reject) => {
    worker.on('error',reject);
    worker.on('message',m => {
      try {
        if (m.type === 'launch') {
          assert.equal(m.id,1);
          assert.equal(m.epoch,1);
          assert.ok(m.ms >= 70);
          launched = true;
          return;
        }
        if (m.type === 'mesh') {
          const {buffer,slot} = m;
          if (m.id === 0) {
            const bytes = new Uint32Array(buffer,0,m.quads*4).slice();
            if (epoch === 1) seed[m.target] = bytes;
            else assert.deepEqual(bytes,seed[m.target]);
            seedMask |= 1 << m.target;
          } else {
            blastMask |= 1 << m.target;
            if (m.id === 1 && m.target >= 2) {
              held.push(m);
              if (held.length === 2) setTimeout(() => {
                for (const packet of held) {
                  worker.postMessage({type:'recycle',slot:packet.slot,buffer:packet.buffer},[packet.buffer]);
                }
                held.length = 0;
              },25);
              return;
            }
            assert.equal(held.length,0,'must wait for a transfer credit');
          }
          worker.postMessage({type:'recycle',slot,buffer},[buffer]);
          return;
        }
        assert.equal(m.type,'end');
        assert.equal(m.epoch,epoch);
        assert.equal(m.mask,m.id ? blastMask : seedMask);
        blastMask = 0;
        worker.postMessage({type:'activate',epoch,id:m.id});
        if (epoch === 2) { assert.equal(seedMask,3); resolve(); return; }
        if (m.id === 0) {
          for (let id = 1; id <= QUEUE; id++) {
            worker.postMessage({type:'blast',epoch,id,origin:[31.5,3.5,34],direction:[0,0,-1],
              radius:5.5,reach:64,rocket:id === 1});
          }
        } else {
          if (m.id === 1) { assert.ok(launched); assert.equal(m.mask & 15,15); }
          order.push(m.id);
          if (m.id === QUEUE) {
            assert.deepEqual(order,[1,2,3,4]);
            seedMask = 0;
            worker.postMessage({type:'reset',epoch:++epoch});
          }
        }
      } catch (error) { reject(error); }
    });
    worker.postMessage({type:'reset',epoch});
  });
});
TEST
cat > README.md <<'README'
# Knockout Yard

Requires Bash, Git with `git init -b`, and Node.js 22 or 24 LTS with npm.
Windows users can use Git Bash or WSL with Node and Git available in that shell.

Run `npm run dev` and open http://localhost:5173. For a phone on the same
network run `npm run dev -- --host 0.0.0.0` and open port 5173 on the host's LAN IP.
Use `npm test` for deterministic engine/protocol tests and `npm run build` followed
by `npm run preview` for the production build.

Choose **Walk** for an over-the-shoulder camera. Use WASD, the arrow keys, or
the on-screen directional pad. Drag to look around and tap to use the selected
tool. **View** or V switches first and third person. **Orbit** restores the
overview. Open **Menu** or use Q/E or 1–3 to select the short-range Sledge,
precision Rifle, or RPG with a visible rocket flight and a wide blast.
To generate another copy, place `bootstrap.sh` in an empty directory and
run `bash bootstrap.sh` there.

## Bounds and protocol

- 64 × 32 × 32 meters, two 32³ chunks, 1 m voxels. Anchor cells occupy world y=0.
  Blasts are centered on the hit cell center, include the radius boundary, and
  cap at 6 m. Picking uses half-open cells and advances tied DDA axes together.
- A static section starts with fewer than 2,048 solids and can only lose solids.
  Six potential exposed faces per initial solid bounds each mesh at 12,288 quads.
  There are two copies of each static section. Four bodies have two section slots
  each. A visual island can contain up to 768 cells, bounding each section at
  4,608 quads. Islands are offered slots in ascending scan order. Overflow
  removes the island normally and increments the omission counter.
- One quad costs 40 bytes. Mesh capacity is 3,440,680 bytes each on CPU and GPU.
  Worker voxel/BFS arrays use 458,752 bytes, plus small workspaces and two
  491,520-byte transferable packets. The maximum is 13 draws (2 static, 8
  island sections, 1 instanced chip mesh, 1 avatar/rocket mesh, 1 ground).
  Framebuffers, driver copies, JS objects, and library
  allocations are outside the tracked buffer estimate.
- Main sends `reset{epoch}`, `blast{epoch,id,origin,direction,radius,reach,rocket}`,
  `activate{epoch,id}`, `tick{epoch,dx,dz}`, and `pause{epoch}`. Four input credits
  include the executing command. New taps are dropped when all credits are used.
- Worker sends `mesh{epoch,id,slot,target,quads,buffer}` followed by
  `end{epoch,id,mask,chips}`. Targets 0–1 are static sections and targets 2–9
  are body sections. Indices start at byte 196608. The main thread copies active
  ranges into persistent attributes, stages one packet per rendered frame, and
  sends `recycle{slot,buffer}` with transfer after upload or stale rejection.
  The receiver owns the packet after each transfer. Exhausted packet credits
  park the producer. Reset invalidates old revisions, including queued work.
  The RPG's `launch` message carries the authoritative target and flight time.
  Its impact holds its FIFO position while the worker continues handling ticks.
- Draw ranges switch together at the frame boundary. The worker begins falling
  on receipt of `activate` after rendering that frame. A one-in-flight tick
  returns `pose{epoch,id,0,1,2,3,...stats}`, with null slots for inactive bodies.
  The simulation uses 60 fixed steps per simulated second, capped at four per
  tick, and bodies expire after three simulated seconds.
- The worker resolves walking against static voxels with axis-separated sliding
  and one-voxel step-up. Up to 48 directly blasted voxels become rotating
  chips with impulse, gravity and damped collision against the ground and
  static voxels. Extra cells still break. Chip pose and birth snapshots are
  fixed 960-byte structured-clone arrays. Chips and islands do not collide
  with each other.
- Initial resolution is 50% of CSS pixels and adapts through 66% and 82%,
  capped at 1280 × 900. Quality never changes the simulation. WebGL 2 and a
  module worker are required. Context loss requires reload.

## Benchmark

Open `/?bench=1&device=MODEL&os=VERSION&hz=60` on a physical phone set to
60 Hz. Keep the tab visible. There is a ten-second warm-up followed by ten
minutes of scripted rays with resets every six seconds. The fixed camera is
restored on reset. Inspect `window.benchResult` for overall, first-minute, and
last-minute frame interval percentiles in that order. Quality counts use
ascending resolution tier order. A quick functional run uses `?bench=smoke`.

Blast latency measures from accepted input through CPU submission of the first
coherent WebGL frame. It is a proxy for display latency. Upload bytes count
active staged ranges and exclude initial allocation. Slice mean and count are
for the timed phase, while the maximum and queue high-water mark include warm-up.
Frame intervals cannot establish the causes of stalls.

| Device | Physical-device result |
| --- | --- |
| Huawei Nova 14i | NOT RUN |
| Huawei Nova Y61 | NOT RUN |
| Realme C55 | NOT RUN |
README

npm install
npm test
npm run build

message='Initial commit: Production-ready Mobile-Optimized Voxel Destruction Engine with Dynamic Island Extraction and Zero-Allocation BFS'
author=$(git var GIT_AUTHOR_IDENT 2>/dev/null || true)
committer=$(git var GIT_COMMITTER_IDENT 2>/dev/null || true)
committed=false
if [[ -n "$author" && -n "$committer" &&
      "$author $committer" != *noreply@anthropic.com* &&
      "$author" != Codex\ * && "$committer" != Codex\ * ]]; then
  git add .
  git commit -m "$message"
  committed=true
fi
printf '\nFrom the directory containing bootstrap.sh, run:\n'
printf '  cd voxel-destruction\n  npm run dev\n'
printf '\nPhone on the same LAN:\n  npm run dev -- --host 0.0.0.0\n'
printf '  Open http://HOST_LAN_IP:5173/?bench=1 on the phone for the full benchmark.\n'
printf '\nGit commands from inside voxel-destruction:\n'
if [[ "$committed" = false ]]; then
  printf '  git config user.name "YOUR NAME"\n  git config user.email "YOUR EMAIL"\n'
  printf '  git add .\n  git commit -m "%s"\n' "$message"
fi
if [[ -z "$remote" ]]; then
  printf '  git remote add origin https://github.com/REPLACE_OWNER/REPLACE_REPO.git\n'
fi
printf '  git push -u origin main\n'
