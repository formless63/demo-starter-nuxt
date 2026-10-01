import assert from 'node:assert/strict'

type Cursor = [1, number, string, string]
interface Codec {
  encodeSearchCursor: (value: Cursor) => string
  decodeSearchCursor: (value: string) => Cursor
  searchDefaults: { maxCursorLength: number }
}
export const goldenCursor: Cursor = [1, 0.2857142984867096, '2026-01-01T00:00:00.000001Z', ' Ω界😀 ']
export const goldenToken = 'WzEsMC4yODU3MTQyOTg0ODY3MDk2LCIyMDI2LTAxLTAxVDAwOjAwOjAwLjAwMDAwMVoiLCIgzqnnlYzwn5iAICJd'
export const tokenFor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const rawToken = (json: string) => Buffer.from(json).toString('base64url')
const date = goldenCursor[2]
const padBitsCanonical = tokenFor([1, 0.5, date, 'opaque'])
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const alternatePadBits = padBitsCanonical.slice(0, -1) + alphabet[alphabet.indexOf(padBitsCanonical.at(-1)!) + 1]
export const invalidTuples: unknown[] = [
  [2, 0.5, date, 'id'], [1, '0.5', date, 'id'], [1, 0.2857143, date, 'id'],
  [1, 0.1, date, 'id'], [1, -0.5, date, 'id'], [1, 2, date, 'id'],
  [1, 0.5, date, ''], [1, 0.5, date, 'x'.repeat(129)],
  ...['\0', '\u001f', '\u007f', '\u0080', '\u0085', '\u009f', '\ud800', '\udfff'].map(id => [1, 0.5, date, id]),
  ...['0000-01-01T00:00:00.000001Z', '2026-02-29T00:00:00.000001Z', '1900-02-29T00:00:00.000001Z',
    '2026-02-30T00:00:00.000001Z', '2026-13-01T00:00:00.000001Z', '2026-01-01T24:00:00.000001Z',
    '2026-01-01T00:60:00.000001Z', '2026-01-01T00:00:60.000001Z', '2026-01-01T00:00:00.001Z',
    '2026-01-01T00:00:00.000001+00:00'].map(timestamp => [1, 0.5, timestamp, 'id']),
  [1, 0.5, date, 'id', 'extra'], [1, 0.5, date], {}, null,
]
export const invalidTokens = [
  '', '!', '+/', 'a'.repeat(2048), 'a'.repeat(2049), goldenToken + '=', goldenToken + '==', ' ' + goldenToken, goldenToken + '\n',
  ...invalidTuples.map(tokenFor),
  rawToken(`[1,-0,"${date}","id"]`), rawToken(`[1,0.50,"${date}","id"]`),
  rawToken(`[1,5e-1,"${date}","id"]`), rawToken(`[ 1,0.5,"${date}","id"]`),
  rawToken(`[1,0.5,"${date}","\\u0069d"]`),
  Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(goldenCursor))]).toString('base64url'),
  // Alternate unused base64 pad bits decode to the same bytes but are not canonical.
  alternatePadBits,
  Buffer.concat([Buffer.from(`[1,0.5,"${date}","`), Buffer.from([0xc0, 0xaf]), Buffer.from('"]')]).toString('base64url'),
]

// Shared by source verification and the independent packed consumer.
export function verifyCursorContract(codec: Codec) {
  const { encodeSearchCursor: encode, decodeSearchCursor: decode } = codec
  const invalid = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'invalid-query'
  assert.equal(codec.searchDefaults.maxCursorLength, 2048)
  assert.equal(encode(goldenCursor), goldenToken)
  assert.deepEqual(decode(goldenToken), goldenCursor)
  assert.equal(encode(decode(goldenToken)), goldenToken)
  assert.deepEqual(Buffer.from(alternatePadBits, 'base64url'), Buffer.from(padBitsCanonical, 'base64url'))
  assert.equal(Math.fround(Number('0.2857143')), goldenCursor[1])
  const real = Buffer.alloc(4)
  real.writeFloatBE(goldenCursor[1])
  assert.equal(real.toString('hex'), '3e924925')
  for (const rank of [0, 0.5, 0.3333333432674408, 0.6666666865348816, 1.401298464324817e-45, 1]) {
    for (const id of [' Ω界😀 ', ' ', 'e\u0301', '界'.repeat(128), '😀'.repeat(64), '"\\']) {
      const tuple: Cursor = [1, rank, date, id]
      assert.deepEqual(decode(encode(tuple)), tuple)
    }
  }
  for (const timestamp of ['0001-01-01T00:00:00.000001Z', '2000-02-29T23:59:59.999999Z', '9999-12-31T23:59:59.999999Z']) {
    const tuple: Cursor = [1, 0.5, timestamp, 'id']
    assert.deepEqual(decode(encode(tuple)), tuple)
  }
  for (const tuple of [...invalidTuples, [1, -0, date, 'id'], [1, NaN, date, 'id'], [1, Infinity, date, 'id']]) {
    assert.throws(() => encode(tuple as Cursor), invalid)
  }
  for (const token of invalidTokens) assert.throws(() => decode(token), invalid)
}
