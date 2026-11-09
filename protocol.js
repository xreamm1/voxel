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
  charge = null;
  removed = 0;
  packets = [];
  clear(recycle) {
    for (const packet of this.packets) recycle(packet);
    this.packets.length = 0;
    this.id = -1;
    this.mask = 0;
    this.expected = -1;
    this.chips = null;
    this.charge = null;
    this.removed = 0;
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
      this.charge = message.charge;
      this.removed = message.removed || 0;
    }
  }
  ready() { return this.id >= 0 && this.packets.length === 0 && this.mask === this.expected; }
}
