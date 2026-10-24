import { writeFileSync } from 'node:fs'

// Canonical, hand-written WASM source, using numeric opcodes from the core/SIMD
// instruction sets. No assembler dependency. Rebuild from the worktree root:
// node apps/server/tools/build-value-simd.mjs
// dense(input, weight, bias, output, rows, columns, batch, slope, mask)
// All pointers are byte offsets; mask=0 computes all rows. slope=1 is linear.
const u32 = (n) => {
  const bytes = []
  do {
    const byte = n & 127
    n >>>= 7
    bytes.push(byte | (n ? 128 : 0))
  } while (n)
  return bytes
}
const vector = (items) => [...u32(items.length), ...items.flat()]
const section = (id, bytes) => [id, ...u32(bytes.length), ...bytes]
const name = (text) => [...u32(text.length), ...Buffer.from(text)]
const code = []
const emit = (...bytes) => code.push(...bytes.flat())
const get = (i) => emit(0x20, u32(i))
const set = (i) => emit(0x21, u32(i))
const constant = (i) => emit(0x41, u32(i)) // Only small positive constants here.
const simd = (op, ...args) => emit(0xfd, u32(op), ...args)
const load = () => emit(0x2a, 2, 0)
const add = () => emit(0x6a)
const mul = () => emit(0x6c)
const advance = (i, amount) => {
  get(i)
  constant(amount)
  add()
  set(i)
}
const loop = (index, limit, body) => {
  constant(0)
  set(index)
  emit(0x02, 0x40, 0x03, 0x40) // block; loop
  get(index)
  get(limit)
  emit(0x4f, 0x0d, 1) // ge_u; br_if exit
  body()
  advance(index, 1)
  emit(0x0c, 0, 0x0b, 0x0b)
}
// Locals: b=9,r=10,c=11,inputRows=12..15,weightRow=16,sum=17,
// accumulators=18..21,weightVector=22. Four batch rows share each weight
// load. Each accumulator keeps the original multiply/add and lane-reduction
// order, including scalar tails, so results remain bit-identical.
const denseRows = (width) => {
  for (let b = 0; b < width; b++) {
    get(0)
    get(9)
    constant(b)
    add()
    get(5)
    mul()
    constant(4)
    mul()
    add()
    set(12 + b)
  }
  loop(10, 4, () => {
    // A requested output row, or no mask. Hidden layers always have mask=0.
    get(8)
    emit(0x45, 0x04, 0x7f)
    constant(1)
    emit(0x05)
    get(8)
    get(10)
    add()
    emit(0x2d, 0, 0, 0x0b)
    emit(0x04, 0x40)
    get(1)
    get(10)
    get(5)
    mul()
    constant(4)
    mul()
    add()
    set(16)
    for (let b = 0; b < width; b++) {
      simd(12, ...new Array(16).fill(0))
      set(18 + b) // v128.const 0
    }
    constant(0)
    set(11)
    emit(0x02, 0x40, 0x03, 0x40)
    get(11)
    constant(4)
    add()
    get(5)
    emit(0x4b, 0x0d, 1)
    get(16)
    get(11)
    constant(4)
    mul()
    add()
    simd(0, 2, 0)
    set(22)
    for (let b = 0; b < width; b++) {
      get(18 + b)
      get(22)
      get(12 + b)
      get(11)
      constant(4)
      mul()
      add()
      simd(0, 2, 0)
      simd(230)
      simd(228)
      set(18 + b) // f32x4.mul; f32x4.add
    }
    advance(11, 4)
    emit(0x0c, 0, 0x0b, 0x0b)
    for (let b = 0; b < width; b++) {
      get(2)
      get(10)
      constant(4)
      mul()
      add()
      load()
      for (let lane = 0; lane < 4; lane++) {
        get(18 + b)
        simd(31, lane)
        emit(0x92) // extract_lane; f32.add
      }
      set(17)
      // Reset the scalar tail for each independent dot product.
      get(5)
      constant(4)
      emit(0x6e) // i32.div_u
      constant(4)
      mul()
      set(11)
      emit(0x02, 0x40, 0x03, 0x40)
      get(11)
      get(5)
      emit(0x4f, 0x0d, 1)
      get(17)
      get(16)
      get(11)
      constant(4)
      mul()
      add()
      load()
      get(12 + b)
      get(11)
      constant(4)
      mul()
      add()
      load()
      emit(0x94, 0x92)
      set(17)
      advance(11, 1)
      emit(0x0c, 0, 0x0b, 0x0b)
      get(3)
      get(9)
      constant(b)
      add()
      get(4)
      mul()
      get(10)
      add()
      constant(4)
      mul()
      add()
      get(17)
      emit(0x43, 0, 0, 0, 0, 0x5d, 0x04, 0x7d) // sum < 0
      get(17)
      get(7)
      emit(0x94, 0x05)
      get(17)
      emit(0x0b)
      emit(0x38, 2, 0) // store
    }
    emit(0x0b) // end requested-row branch
  })
}
loop(9, 6, () => {
  get(9)
  constant(4)
  add()
  get(6)
  emit(0x4d, 0x04, 0x40) // b + 4 <= batch
  denseRows(4)
  advance(9, 3) // The outer loop adds the fourth row.
  emit(0x05)
  denseRows(1)
  emit(0x0b)
})
emit(0x0b)
const params = [0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7d, 0x7f]
const body = [
  ...vector([
    [8, 0x7f],
    [1, 0x7d],
    [5, 0x7b],
  ]),
  ...code,
]
const bytes = Uint8Array.from([
  0,
  97,
  115,
  109,
  1,
  0,
  0,
  0,
  ...section(1, vector([[0x60, ...vector(params), 0]])),
  ...section(3, vector([[0]])),
  ...section(5, vector([[0, 1]])),
  ...section(
    7,
    vector([
      [...name('memory'), 2, 0],
      [...name('dense'), 0, 0],
    ]),
  ),
  ...section(10, vector([[...u32(body.length), ...body]])),
])
if (!WebAssembly.validate(bytes)) throw new Error('invalid SIMD module')
writeFileSync(
  new URL('../src/bot-value-simd-bytes.ts', import.meta.url),
  '// Generated by node apps/server/tools/build-value-simd.mjs; do not edit.\n' +
    `export const VALUE_SIMD_BASE64 =\n  '${Buffer.from(bytes).toString('base64')}'\n`,
)
