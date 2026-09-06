/**
 * How far each clip actually moves each bone, read from the shipped GLB.
 *
 * The amplitude question has been chased in a browser twice and answered neither
 * time, because a scene only animates in a tab that is compositing and a
 * backgrounded tab reports a clip running perfectly while nothing moves. It does
 * not need a browser: the rotation is in the sampler output, and the largest
 * angle a bone reaches away from its own rest is arithmetic.
 *
 * Reports, per clip, the bones that move most and how far in degrees. A clip
 * whose largest rotation is a twentieth of a degree is running correctly and is
 * invisible, which is the distinction that matters here.
 *
 * Run: node art/pipeline/measure_clip_amplitude.mjs <glb> [minDegrees]
 */
import fs from 'node:fs';

const CT = { 5126: Float32Array, 5123: Uint16Array, 5121: Uint8Array, 5122: Int16Array, 5120: Int8Array };
const SIZE = { 5126: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1 };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function read(gltf, bin, index) {
  const acc = gltf.accessors[index];
  const view = gltf.bufferViews[acc.bufferView];
  const Arr = CT[acc.componentType];
  const width = SIZE[acc.componentType];
  const n = NUM[acc.type];
  const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = view.byteStride || n * width;
  const out = [];
  for (let e = 0; e < acc.count; e++) {
    const row = [];
    for (let c = 0; c < n; c++) {
      row.push(new Arr(bin.buffer, bin.byteOffset + base + e * stride + c * width, 1)[0]);
    }
    out.push(n === 1 ? row[0] : row);
  }
  return out;
}

/** Angle between two unit quaternions, in degrees, taking the short way round. */
function between(a, b) {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

const file = process.argv[2];
const floor = Number(process.argv[3] ?? 0);
if (!file) throw new Error('usage: measure_clip_amplitude.mjs <glb> [minDegrees]');

const buf = fs.readFileSync(file);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
const bin = buf.slice(20 + jsonLen + 8);
const nodeName = (i) => (gltf.nodes[i] && gltf.nodes[i].name) || `node${i}`;

console.log(`clips in ${file.split(/[\\/]/).pop()}: ${(gltf.animations || []).length}\n`);

for (const clip of gltf.animations || []) {
  const rows = [];
  let deadChannels = 0;
  for (const channel of clip.channels) {
    if (channel.target.path !== 'rotation') continue;
    const node = gltf.nodes[channel.target.node];
    if (node === undefined) {
      deadChannels += 1;
      continue;
    }
    const values = read(gltf, bin, clip.samplers[channel.sampler].output);
    // Against the node's own rest rotation, not against the first key: a clip
    // that starts away from rest and holds is still a pose change, and one that
    // wanders and returns is still motion.
    const rest = node.rotation || [0, 0, 0, 1];
    let peak = 0;
    for (const q of values) peak = Math.max(peak, between(q, rest));
    rows.push({ bone: nodeName(channel.target.node), deg: peak });
  }
  rows.sort((a, b) => b.deg - a.deg);
  const moving = rows.filter((r) => r.deg > 0.0005);
  const widest = rows[0]?.deg ?? 0;
  const verdict = widest < 1 ? 'INVISIBLE' : widest < 5 ? 'faint' : 'visible';
  console.log(
    `${clip.name.padEnd(16)} rotationChannels=${String(rows.length).padStart(3)}  ` +
      `moving=${String(moving.length).padStart(3)}  widest=${widest.toFixed(3)} deg  ${verdict}` +
      (deadChannels ? `  DEAD CHANNELS: ${deadChannels}` : ''),
  );
  for (const row of rows.slice(0, 4)) {
    if (row.deg < floor) continue;
    console.log(`    ${row.bone.padEnd(20)} ${row.deg.toFixed(3)}`);
  }
}
