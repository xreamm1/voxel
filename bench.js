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
