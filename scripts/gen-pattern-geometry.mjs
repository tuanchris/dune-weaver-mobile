// Build-time: bundle the pattern library for the app from the sibling
// dune-weaver repo. Emits, into assets/:
//   previews/<name>.webp     -> the pre-rendered preview from dune-weaver's
//                               patterns/cached_images, for the DEFAULT
//                               (top-level) patterns ONLY (~100). Custom
//                               (nested custom_patterns/...) previews are NOT
//                               bundled — they live in app storage (generated on
//                               import, or ingested in Settings) to keep the
//                               binary small. Keyed by the pattern's filename.
//   thr/<name>.thr           -> the DECIMATED theta-rho for the TOP-LEVEL built-in
//                               patterns only (these are the ones the app can push
//                               to a table + animate). Custom patterns already live
//                               on the SD, so we don't bundle their (large) .thr —
//                               just their preview image.
//   pattern-manifest.js      -> static require() maps THR/PREVIEW (Metro needs
//                               literal require paths).
//
// Run:  node scripts/gen-pattern-geometry.mjs
// Requires the dune-weaver repo checked out as a sibling folder.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decimateThrText, MAX_POINTS } from '../src/lib/thrGeometry.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT = path.resolve(__dirname, '..')
const DW = path.resolve(PROJECT, '..', 'dune-weaver')
const SRC = path.join(DW, 'patterns')
const PREVIEW_SRC = path.join(SRC, 'cached_images')

const OUT = path.join(PROJECT, 'assets')
const THR_OUT = path.join(OUT, 'thr')
const PREVIEW_OUT = path.join(OUT, 'previews')

/** Escape a string for use inside a single-quoted require() path / key. */
function q(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
}

/** All .thr under SRC (recursive), as forward-slash paths relative to SRC,
 *  excluding the cached_images preview tree. */
function findThr(dir, rel = '') {
  const out = []
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name === 'cached_images') continue
    const relPath = rel ? `${rel}/${ent.name}` : ent.name
    if (ent.isDirectory()) {
      out.push(...findThr(path.join(dir, ent.name), relPath))
    } else if (ent.name.toLowerCase().endsWith('.thr')) {
      out.push(relPath)
    }
  }
  return out
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Source patterns dir not found: ${SRC}`)
    process.exit(1)
  }

  rmrf(THR_OUT)
  rmrf(PREVIEW_OUT)
  fs.mkdirSync(THR_OUT, { recursive: true })
  fs.mkdirSync(PREVIEW_OUT, { recursive: true })

  const rels = findThr(SRC).sort((a, b) => a.localeCompare(b))

  const thrEntries = [] // top-level only: { name }
  const previewEntries = [] // top-level only: { key, file } (file = relpath under previews/)
  let thrBytes = 0
  let webpBytes = 0
  let noPreview = 0
  let thrSkipped = 0

  for (const rel of rels) {
    const isTopLevel = !rel.includes('/')

    // Preview: bundle the pre-rendered webp for the DEFAULT (top-level) patterns
    // ONLY (~100). Custom (nested) pattern previews are NOT bundled — they live
    // in app storage instead (generated on import, or ingested in Settings),
    // keeping the app binary small. See PatternThumb's resolution order.
    if (isTopLevel) {
      // dw's cached_images are named "<name>.thr.webp". We copy them to a SINGLE
      // extension "<name>.webp": the embedded ".thr" (also a Metro assetExt)
      // makes the dev server mis-encode the asset path and spam ENOENT scandir
      // errors. The manifest KEY stays "<name>.thr" so previewSource lookups by
      // pattern filename are unchanged.
      const webpSrc = path.join(PREVIEW_SRC, `${rel}.webp`)
      if (fs.existsSync(webpSrc)) {
        const destRel = `${rel.replace(/\.thr$/i, '')}.webp`
        const dest = path.join(PREVIEW_OUT, destRel)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(webpSrc, dest)
        webpBytes += fs.statSync(webpSrc).size
        previewEntries.push({ key: rel, file: destRel })
      } else {
        noPreview++
      }
    }

    // Geometry: bundle the full-res (decimated) .thr for the DEFAULT (top-level)
    // patterns only — these are pushable + animated. Custom pattern geometry is
    // NOT bundled; it's read from the SD card on demand (see useLibrary.ensureXY).
    if (isTopLevel) {
      try {
        const decimated = decimateThrText(fs.readFileSync(path.join(SRC, rel), 'utf8'), MAX_POINTS)
        if (decimated.trim().length === 0) {
          thrSkipped++
        } else {
          fs.writeFileSync(path.join(THR_OUT, rel), decimated)
          thrBytes += Buffer.byteLength(decimated)
          thrEntries.push({ name: rel })
        }
      } catch (e) {
        console.warn(`skip thr ${rel}: ${e.message}`)
        thrSkipped++
      }
    }
  }

  // Emit the manifest module of static require()s.
  const thrLines = thrEntries.map((e) => `  '${q(e.name)}': require('./thr/${q(e.name)}'),`)
  const previewLines = previewEntries.map((e) => `  '${q(e.key)}': require('./previews/${q(e.file)}'),`)

  const manifest =
    `// AUTO-GENERATED by scripts/gen-pattern-geometry.mjs — do not edit.\n` +
    `// Only the DEFAULT (top-level) ~100 patterns are bundled. Custom patterns'\n` +
    `// previews + geometry are not bundled — they live in app storage / read from SD.\n` +
    `// PREVIEW: pre-rendered webp for the default patterns, keyed by filename.\n` +
    `// THR: full-res decimated theta-rho for the default patterns (push + animation).\n\n` +
    `export const THR = {\n${thrLines.join('\n')}\n}\n\n` +
    `export const PREVIEW = {\n${previewLines.join('\n')}\n}\n\n` +
    `export const NAMES = Object.keys(THR)\n`

  fs.writeFileSync(path.join(OUT, 'pattern-manifest.js'), manifest)

  console.log(
    `Bundled ${previewEntries.length} previews (${(webpBytes / 1024 / 1024).toFixed(1)} MB), ` +
      `${thrEntries.length} built-in .thr (${(thrBytes / 1024 / 1024).toFixed(2)} MB).`
  )
  if (noPreview) console.log(`${noPreview} pattern(s) had no preview image.`)
  if (thrSkipped) console.log(`Skipped ${thrSkipped} top-level .thr.`)
}

main()
