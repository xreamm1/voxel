# Knockout Yard

Requires Bash, Git with `git init -b`, and Node.js 22 or 24 LTS with npm.
Windows users can use Git Bash or WSL with Node and Git available in that shell.

Run `npm run dev` and open http://localhost:5173. For a phone on the same
network run `npm run dev -- --host 0.0.0.0` and open port 5173 on the host's LAN IP.
Use `npm test` for deterministic engine/protocol tests and `npm run build` followed
by `npm run preview` for the production build.

The yard starts with an over-the-shoulder camera. Use WASD, the arrow keys, or
the on-screen directional pad. Drag to look around and tap to use the selected
tool. **View** or V switches first and third person. **Orbit** restores the
overview. Open **Menu** or use Q/E to choose an item. Press 1–3 to cycle the
melee, firearm, and explosive groups. C4 places on the first tap and detonates
on the next. The menu toggles rain and restores the map. The park paving can
be excavated to the permanent world anchor layer.
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
- Main sends `reset{epoch}`, `blast{epoch,id,origin,direction,radius,reach,rocket,charge}`,
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
