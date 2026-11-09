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
  scene.background = new T.Color('#171526');
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
    uniforms:{palette:{value:['#293940','#f0ad33','#468a94','#b44539',
      '#eeeeed','#636b76','#46504b','#396032','#575962','#745143',
      '#415979','#4a693e','#eef2fb','#777278','#8c794d','#66646d']
      .map(color => new T.Color(color))}},
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
      uniform vec3 palette[16];
      flat in uint materialId;
      flat in float shade;
      out vec4 pixel;
      void main() {
        float lighting = materialId == 12u ? 1.0 : 0.57 * shade;
        vec3 linear = palette[int(materialId & 15u)] * lighting;
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
  const actor = new T.InstancedMesh(actorGeometry,chipMaterial,10);
  actor.instanceMatrix.setUsage(T.DynamicDrawUsage);
  actor.frustumCulled = false;
  actor.count = 1;
  actor.setMatrixAt(0,chipTransform.matrix);
  actor.onAfterRender = () => { if (actor.count) draws[2]++; };
  scene.add(actor);
  const root = new T.Object3D(), part = new T.Object3D(), matrix = new T.Matrix4();
  const rocketFrom = new T.Vector3(), rocketTo = new T.Vector3();
  let rocket = null, actorCount = 0, charge = null;
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
      const swing = walk.melee ? Math.sin(action*Math.PI)*1.8 + Math.sin(equip*Math.PI)*.8 :
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
      if (walk.melee) {
        box(.51,1.39+swing*.36,-.28,.22,walk.tool === 1 ? .72 : .53,.34,1,-swing);
      } else box(.51,1.22,-.39+action*.12,.20,.23,walk.tool === 5 ? .82 : .5,3);
    }
    if (rocket) {
      const t = Math.min(1,(now-rocket.start)/rocket.ms);
      root.position.lerpVectors(rocketFrom,rocketTo,Math.max(0,t));
      root.rotation.set(0,0,0);
      root.updateMatrix();
      box(0,0,0,.19,.19,.19,3);
      if (t >= 1) rocket = null;
    }
    if (charge) {
      root.position.fromArray(charge.pose);
      root.rotation.set(0,0,0);
      root.updateMatrix();
      box(0,0,0,.22,.22,.22,now % 900 < 200 ? 12 : 3);
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
  let ready = false, tickPending = false, stats, previousFrame = 0, entered = false, destroyed = 0;
  const weather = document.querySelector('#weather');
  const weatherToggle = document.querySelector('#weather-toggle');
  const score = document.querySelector('#destroyed');
  weather.hidden = params.has('bench') || params.has('clear');
  weatherToggle.textContent = weather.hidden ? 'Weather · Clear' : 'Weather · Rain';
  weatherToggle.onclick = () => {
    weather.hidden = !weather.hidden;
    weatherToggle.textContent = weather.hidden ? 'Weather · Clear' : 'Weather · Rain';
  };
  document.querySelector('#refresh-map').onclick = () => {
    document.querySelector('#loadout').close();
    reset();
  };
  let needsDrawCheck = true;
  const renderBytes = (CHUNKS*2*STATIC_CAP + CHUNKS*BODIES*BODY_CAP + 1)*40;
  const tracked = {
    renderCpuBytes:renderBytes, gpuMeshCapacityBytes:renderBytes,
    workerAndTransferBytes:7*VOLUME + SLOTS*PACKET_BYTES + 4096 + CHIP_COUNT*61,
    chipCpuGpuBytes:2*(CHIP_COUNT*68 + packed.byteLength + chipGeometry.index.array.byteLength) +
      chipData.byteLength,
    actorCpuGpuBytes:2*(10*64 + actorColors.array.byteLength + packed.byteLength +
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

  function shoot(origin,direction,radius,reach,rocket,charge) {
    const id = ready && !failed ? ledger.accept(performance.now()) : 0;
    bench?.input(Boolean(id));
    if (id) worker.postMessage({type:'blast',epoch:ledger.epoch,id,origin,direction,radius,reach,rocket,charge});
  }
  function reset() {
    if (failed) return;
    ready = false;
    button.disabled = true;
    walk.ready(false);
    walk.reset();
    rocket = null;
    charge = null;
    walk.setCharge(false);
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
      if (tool) shoot(ray.ray.origin.toArray(),ray.ray.direction.toArray(),tool.radius,tool.reach,
        tool.rocket,tool.charge);
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
    charge = stage.charge;
    walk.setCharge(Boolean(charge));
    if (stage.removed) {
      destroyed += stage.removed;
      score.textContent = String(destroyed);
    }
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
          if (!entered && !bench && !params.has('orbit')) document.querySelector('#walk').click();
          entered = true;
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
