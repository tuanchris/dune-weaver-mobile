// Create playlists on a Dune Weaver table from a dw-format playlists.json
// ({ "<name>": ["pattern.thr", "custom_patterns/.../x.thr", ...], ... }).
//
// Uploads each as /playlists/<name>.txt via the firmware's /upload route — the
// same multipart shape src/api/board.ts uses: a "<sdPath>S" size field followed
// by the file part whose filename IS the destination SD path. Each pattern is
// written as a "/patterns/<relpath>" line (the firmware runs entries by path and
// prepends "/" to any line missing one), so nested custom_patterns/ entries work.
//
// Run (table must be IDLE — uploads are blocked during motion):
//   node scripts/create-playlists.mjs http://<board-ip> [path/to/playlists.json]
//
// Requires Node 18+ (global fetch/FormData/Blob).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FIRMWARE_MAX_ITEMS = 1024 // PlaylistParse MAX_ITEMS — extras are ignored at run time

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_JSON = path.resolve(__dirname, '..', '..', 'dune-weaver', 'playlists.json')

function normalizeBase(input) {
  let s = (input || '').trim()
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`
  return s.replace(/\/+$/, '')
}

async function uploadPlaylist(base, name, items) {
  const sdPath = `/playlists/${name}.txt`
  const content = items.map((p) => `/patterns/${p}`).join('\n') + '\n'
  const bytes = Buffer.byteLength(content)

  const form = new FormData()
  form.append(`${sdPath}S`, String(bytes)) // size field must precede the file part
  form.append('file', new Blob([content], { type: 'application/octet-stream' }), sdPath)

  const res = await fetch(`${base}/upload`, { method: 'POST', body: form })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${body.trim()}`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  // --skip="name one,name two" excludes playlists by name.
  const skipArg = args.find((a) => a.startsWith('--skip='))
  const skip = new Set(skipArg ? skipArg.slice('--skip='.length).split(',').map((s) => s.trim()) : [])
  const positional = args.filter((a) => !a.startsWith('--'))

  const base = normalizeBase(positional[0])
  if (!base) {
    console.error('usage: node scripts/create-playlists.mjs http://<board-ip> [playlists.json] [--skip="A,B"]')
    process.exit(1)
  }
  const jsonPath = positional[1] ? path.resolve(positional[1]) : DEFAULT_JSON
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))

  console.log(`Creating ${Object.keys(data).length} playlist(s) on ${base}\n`)
  let ok = 0
  let failed = 0
  for (const [name, items] of Object.entries(data)) {
    if (skip.has(name)) {
      console.log(`· skip "${name}" (excluded)`)
      continue
    }
    if (!Array.isArray(items) || items.length === 0) {
      console.log(`· skip "${name}" (empty)`)
      continue
    }
    try {
      await uploadPlaylist(base, name, items)
      const note = items.length > FIRMWARE_MAX_ITEMS ? ` (firmware runs first ${FIRMWARE_MAX_ITEMS})` : ''
      console.log(`✓ "${name}" — ${items.length} patterns${note}`)
      ok++
    } catch (e) {
      console.error(`✗ "${name}" — ${e.message}`)
      failed++
    }
  }
  console.log(`\nDone: ${ok} created, ${failed} failed.`)
  if (failed) process.exit(1)
}

main()
