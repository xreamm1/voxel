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
}

// Slab entry followed by half-open cells. At a tie advance every tied axis.
export function raycast(world, origin, direction, hit, slab) {
  let first = 0, last = Infinity;
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

export function* blast(world, x, y, z, radius, dirty) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z) ||
      !inside(x, y, z) || !Number.isFinite(radius) || radius <= 0) return 0;
  radius = Math.min(radius, MAX_RADIUS);
  const extent = Math.floor(radius), squared = radius * radius;
  let removed = 0;
  for (let k = Math.max(0, z - extent); k <= Math.min(31, z + extent); k++) {
    for (let j = Math.max(1, y - extent); j <= Math.min(31, y + extent); j++) {
      for (let i = Math.max(0, x - extent); i <= Math.min(63, x + extent); i++) {
        if ((i-x)**2 + (j-y)**2 + (k-z)**2 > squared || !world.get(i,j,k)) continue;
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
