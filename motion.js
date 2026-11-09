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
