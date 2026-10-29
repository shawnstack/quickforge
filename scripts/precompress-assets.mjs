/**
 * Emit `.br` / `.gz` siblings for the build output.
 *
 * The local server serves static assets without a reverse proxy, so first
 * paint used to ship the entire JS/CSS payload uncompressed. Compressing at
 * build time keeps request handling CPU-free and makes the compressed bytes
 * immutable along with their source asset.
 *
 * Only text-like files are compressed; binary assets (images/fonts) are already
 * compressed. Files smaller than `MIN_BYTES` are skipped because the framing
 * overhead outweighs the gain.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompress, constants, gzip } from 'node:zlib'
import { promisify } from 'node:util'

const brotli = promisify(brotliCompress)
const gzipAsync = promisify(gzip)

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(projectRoot, 'dist')
const MIN_BYTES = 512
const COMPRESSIBLE_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt'])

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

async function emitCompressed(filePath, source) {
  const [br, gz] = await Promise.all([
    brotli(source, {
      params: {
        // Quality 9 keeps build time reasonable on this asset graph while
        // staying close to the maximum ratio.
        [constants.BROTLI_PARAM_QUALITY]: 9,
      },
    }),
    gzipAsync(source, { level: 9 }),
  ])
  let bytes = 0
  if (br.length < source.length) {
    await fs.writeFile(`${filePath}.br`, br)
    bytes += br.length
  }
  if (gz.length < source.length) {
    await fs.writeFile(`${filePath}.gz`, gz)
    bytes += gz.length
  }
  return { bytes, br: br.length, gz: gz.length }
}

async function main() {
  let files = 0
  let sourceBytes = 0
  let compressedBytes = 0

  for await (const filePath of walk(distDir)) {
    const extension = path.extname(filePath).toLowerCase()
    if (!COMPRESSIBLE_EXTENSIONS.has(extension)) continue
    const source = await fs.readFile(filePath)
    if (source.length < MIN_BYTES) continue
    const result = await emitCompressed(filePath, source)
    files += 1
    sourceBytes += source.length
    compressedBytes += result.bytes
  }

  const mb = (bytes) => `${(bytes / 1048576).toFixed(2)}MB`
  console.log(`[precompress] ${files} files: ${mb(sourceBytes)} → ${mb(compressedBytes)} across br+gz`)
}

main().catch((error) => {
  console.error('[precompress] failed:', error)
  process.exitCode = 1
})
