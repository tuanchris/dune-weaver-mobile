// Build-time: bundle the pattern library for the app from the sibling
// dune-weaver repo. Emits, into assets/:
//   previews/<relpath>.webp  -> the pre-rendered preview from dune-weaver's
//                               patterns/cached_images, for EVERY pattern in the
//                               library (top-level + nested custom_patterns/...).
//                               Keyed by the pattern's path RELATIVE to /patterns
//                               — exactly what the firmware's /sand_patterns
//                               manifest returns (e.g. "custom_patterns/x.thr"),
//                               so the app shows a bundled image with no SD read.
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
const GEOM_OUT = path.join(OUT, 'geom')

// Compact theta-rho for the NESTED custom patterns (the built-ins already bundle
// full-res .thr). Just enough points to draw the Now-Playing path + position the
// progress ball smoothly — keeps the bundle small (~600 pts vs MAX_POINTS).
const GEOM_POINTS = 600

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
  rmrf(GEOM_OUT)
  fs.mkdirSync(THR_OUT, { recursive: true })
  fs.mkdirSync(PREVIEW_OUT, { recursive: true })
  fs.mkdirSync(GEOM_OUT, { recursive: true })

  const rels = findThr(SRC).sort((a, b) => a.localeCompare(b))

  const thrEntries = [] // top-level only: { name }
  const geomEntries = [] // nested customs: { key, file } (file = relpath under geom/)
  const previewEntries = [] // all: { key, file } (file = relpath under previews/)
  let thrBytes = 0
  let geomBytes = 0
  let webpBytes = 0
  let noPreview = 0
  let thrSkipped = 0

  for (const rel of rels) {
    const isTopLevel = !rel.includes('/')

    // Preview: copy the pre-rendered webp for EVERY pattern, mirroring its path.
    const webpSrc = path.join(PREVIEW_SRC, `${rel}.webp`)
    if (fs.existsSync(webpSrc)) {
      const destRel = `${rel}.webp`
      const dest = path.join(PREVIEW_OUT, destRel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(webpSrc, dest)
      webpBytes += fs.statSync(webpSrc).size
      previewEntries.push({ key: rel, file: destRel })
    } else {
      noPreview++
    }

    // Geometry. Top-level built-ins bundle full-res .thr (pushable + animated).
    // Nested customs (already on the SD) bundle only a COMPACT theta-rho, used to
    // draw the Now-Playing path and position the progress ball.
    try {
      const raw = fs.readFileSync(path.join(SRC, rel), 'utf8')
      if (isTopLevel) {
        const decimated = decimateThrText(raw, MAX_POINTS)
        if (decimated.trim().length === 0) {
          thrSkipped++
        } else {
          fs.writeFileSync(path.join(THR_OUT, rel), decimated)
          thrBytes += Buffer.byteLength(decimated)
          thrEntries.push({ name: rel })
        }
      } else {
        const compact = decimateThrText(raw, GEOM_POINTS)
        if (compact.trim().length > 0) {
          const dest = path.join(GEOM_OUT, rel)
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          fs.writeFileSync(dest, compact)
          geomBytes += Buffer.byteLength(compact)
          geomEntries.push({ key: rel, file: rel })
        }
      }
    } catch (e) {
      console.warn(`skip geom ${rel}: ${e.message}`)
      thrSkipped++
    }
  }

  // Emit the manifest module of static require()s.
  const thrLines = thrEntries.map((e) => `  '${q(e.name)}': require('./thr/${q(e.name)}'),`)
  const geomLines = geomEntries.map((e) => `  '${q(e.key)}': require('./geom/${q(e.file)}'),`)
  const previewLines = previewEntries.map((e) => `  '${q(e.key)}': require('./previews/${q(e.file)}'),`)

  const manifest =
    `// AUTO-GENERATED by scripts/gen-pattern-geometry.mjs — do not edit.\n` +
    `// PREVIEW: pre-rendered webp for every library pattern, keyed by its path\n` +
    `// relative to /patterns (matches the firmware's /sand_patterns manifest).\n` +
    `// THR: full-res decimated geometry for top-level built-ins (push + animation).\n` +
    `// GEOM: compact theta-rho for nested custom patterns (Now-Playing path + ball).\n\n` +
    `export const THR = {\n${thrLines.join('\n')}\n}\n\n` +
    `export const GEOM = {\n${geomLines.join('\n')}\n}\n\n` +
    `export const PREVIEW = {\n${previewLines.join('\n')}\n}\n\n` +
    `export const NAMES = Object.keys(THR)\n`

  fs.writeFileSync(path.join(OUT, 'pattern-manifest.js'), manifest)

  console.log(
    `Bundled ${previewEntries.length} previews (${(webpBytes / 1024 / 1024).toFixed(1)} MB), ` +
      `${thrEntries.length} built-in .thr (${(thrBytes / 1024 / 1024).toFixed(2)} MB), ` +
      `${geomEntries.length} compact geom (${(geomBytes / 1024 / 1024).toFixed(1)} MB).`
  )
  if (noPreview) console.log(`${noPreview} pattern(s) had no preview image.`)
  if (thrSkipped) console.log(`Skipped ${thrSkipped} top-level .thr.`)
}

main()
