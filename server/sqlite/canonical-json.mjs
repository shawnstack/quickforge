// Single-pass canonical JSON serializer.
//
// Byte-identical to the previous pipeline
//   JSON.stringify(canonicalize(JSON.parse(JSON.stringify(value))))
// where canonicalize recursively sorts object keys (UTF-16 code unit order)
// and drops keys whose value is undefined. That pipeline walked every message
// four times (stringify, parse, deep clone, stringify); this walks it once and
// emits chunks directly, cutting persist CPU on large sessions.
//
// Semantics preserved from the composed pipeline:
//  - toJSON is applied where JSON.stringify applies it (once per value; e.g.
//    Date -> ISO string). The key argument is not forwarded — no toJSON in
//    this codebase inspects it.
//  - undefined / functions / symbols: dropped as object values, `null` as
//    array elements (exactly what the JSON round-trip did).
//  - bigint throws (JSON.stringify throws on bigint; callers map errors to
//    their own TypeError).
//  - number/string formatting is delegated to JSON.stringify so the output
//    (escapes, -0 -> "0", NaN/Infinity -> "null", 1e21 -> "1e+21", ...) never
//    diverges from native stringify.
//  - non-plain objects without toJSON serialize their own enumerable string
//    keys, sorted — same as the round-trip flattening them to plain objects.
//
// Equivalence is pinned by the differential test in
// tests/server/canonical-json.test.mjs; any change here must keep it green.

function serializeValue(value, out) {
  if (value !== null && typeof value === 'object' && typeof value.toJSON === 'function') {
    return serializeWithoutToJSON(value.toJSON(), out)
  }
  return serializeWithoutToJSON(value, out)
}

function serializeWithoutToJSON(value, out) {
  if (value === null) {
    out.push('null')
    return true
  }
  switch (typeof value) {
    case 'number':
    case 'string':
    case 'boolean':
      out.push(JSON.stringify(value))
      return true
    case 'bigint':
      throw new TypeError('Do not know how to serialize a BigInt')
    case 'undefined':
    case 'function':
    case 'symbol':
      return false
    case 'object': {
      if (Array.isArray(value)) {
        out.push('[')
        for (let index = 0; index < value.length; index += 1) {
          if (index > 0) out.push(',')
          if (!serializeValue(value[index], out)) out.push('null')
        }
        out.push(']')
        return true
      }
      out.push('{')
      let wroteAny = false
      for (const key of Object.keys(value).sort()) {
        const valueChunks = []
        if (!serializeValue(value[key], valueChunks)) continue
        if (wroteAny) out.push(',')
        out.push(JSON.stringify(key), ':')
        out.push(...valueChunks)
        wroteAny = true
      }
      out.push('}')
      return true
    }
    default:
      // typeof cannot reach here for JSON-reachable values; behave like
      // JSON.stringify would for exotic inputs (treated as omitted).
      return false
  }
}

/**
 * Canonical JSON string for a JSON-compatible value: object keys sorted,
 * undefined-valued keys dropped. Returns undefined only for a top-level
 * undefined/function/symbol, mirroring JSON.stringify(undefined).
 */
export function canonicalJsonStringify(value) {
  const out = []
  if (!serializeValue(value, out)) return undefined
  return out.join('')
}
