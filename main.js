import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {
  BODIES, CHUNKS, VOLUME, SLOTS, STATIC_CAP, BODY_CAP, PACKET_BYTES, VERTEX_WORDS, pack
} from './engine.js';
import {Ledger,Stage} from './protocol.js';
import {benchmark} from './bench.js';

const canvas = document.querySelector('canvas'), status = document.querySelector('#status');
const button = document.querySelector('#reset'), metrics = document.querySelector('#metrics');
const params = new URLSearchParams(location.search);
let failed = false, worker;
function fail(message) {
  failed = true;
  worker?.terminate();
  status.textContent = message;
  button.disabled = true;
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

  const material = new T.RawShaderMaterial({
    glslVersion:T.GLSL3,
    uniforms:{palette:{value:['#293940','#ffc736','#17b7b3','#ff6b47',
      '#f2f5ee','#607584','#9bb0ae','#87b7f2'].map(color => new T.Color(color))}},
    vertexShader:`
      precision highp float;
      precision highp int;
      uniform mat4 projectionMatrix;
      uniform mat4 modelViewMatrix;
      in uint packedVoxel;
      flat out uint materialId;
      flat out float shade;
      void main() {
        uint axis = (packedVoxel >> 18u) & 7u;
        vec3 p = vec3(packedVoxel & 63u, (packedVoxel >> 6u) & 63u, (packedVoxel >> 12u) & 63u);
        vec3 normal = axis < 2u ? vec3(1,0,0) : axis < 4u ? vec3(0,1,0) : vec3(0,0,1);
        if ((axis & 1u) != 0u) normal = -normal;
        shade = 0.63 + 0.37 * max(0.0, dot(normal,normalize(vec3(0.5,0.9,0.6))));
        materialId = (packedVoxel >> 21u) & 255u;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
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
    workerAndTransferBytes:7*VOLUME + SLOTS*PACKET_BYTES + 4096,
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
      } else stage.receive(m,ledger,recycle);
    } catch (error) { fail(error.message); console.error(error); }
  };

  function shoot(origin,direction,radius) {
    const id = ready && !failed ? ledger.accept(performance.now()) : 0;
    bench?.input(Boolean(id));
    if (id) worker.postMessage({type:'blast',epoch:ledger.epoch,id,origin,direction,radius});
  }
  function reset() {
    if (failed) return;
    ready = false;
    button.disabled = true;
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
  const pointers = new Set();
  canvas.addEventListener('pointerdown',event => {
    pointers.add(event.pointerId);
    if (pointers.size === 1 && event.button === 0) {
      pointer = event.pointerId;
      downX = event.clientX;
      downY = event.clientY;
      downTime = performance.now();
      tap = true;
    } else tap = false;
  });
  function moved(event) {
    return (event.clientX-downX)**2 + (event.clientY-downY)**2 > 64;
  }
  canvas.addEventListener('pointermove',event => {
    if (event.pointerId === pointer && moved(event)) tap = false;
  });
  canvas.addEventListener('pointerup',event => {
    pointers.delete(event.pointerId);
    if (event.pointerId !== pointer || !tap || moved(event) || performance.now()-downTime > 450) return;
    tap = false;
    const rect = canvas.getBoundingClientRect();
    ndc.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
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
    if (stage.id === 0) for (let slot = 0; slot < BODIES; slot++) hideBody(slot);
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
      controls.update();
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
          status.textContent = 'Yard open';
        }
      }
      if (!tickPending && !document.hidden) {
        tickPending = true;
        worker.postMessage({type:'tick',epoch:ledger.epoch});
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
