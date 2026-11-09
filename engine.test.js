import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {
  World, Connectivity, Mesher, Bodies, seedWorld, blast, raycast, local, pack, unpack,
  STATIC_CAP, PACKET_BYTES, QUEUE
} from './engine.js';
import {Ledger,Stage,TransferPool} from './protocol.js';

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
  const order = [], seed = [], held = [];
  await new Promise((resolve,reject) => {
    worker.on('error',reject);
    worker.on('message',m => {
      try {
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
            worker.postMessage({type:'blast',epoch,id,origin:[31.5,3.5,34],direction:[0,0,-1],radius:5.5});
          }
        } else {
          if (m.id === 1) assert.equal(m.mask & 15,15);
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
