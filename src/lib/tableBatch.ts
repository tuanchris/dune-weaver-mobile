/**
 * A hub sync's table stage as ONE upload, so it keeps going while the app is
 * away (owner's call, 2026-11-15). The phone writes a single multipart body
 * holding every file into the cache, and Expo's UploadTask
 * sends it: on iOS through the shared BACKGROUND URLSession, which carries on
 * with the app suspended or the phone locked; on Android in-process, kept alive
 * by the sync foreground service (lib/syncService.ts). One request = one
 * connection: the table's single-threaded server can't take several at once
 * (queueing one task per file would open several, since Expo's background
 * session allows a few per host, and chaining them from a suspended app gets
 * throttled by iOS). Firmware >= v0.2.3 only: older builds have no watchdog
 * feed in the upload path, so a request over 120 s panics them, and they
 * don't add uploads to /patterns/index.json themselves.
 * No `<path>S` size fields: the firmware keeps every non-file field of a
 * request and refuses the 33rd (WEBSERVER_MAX_POST_ARGS), and a file that
 * doesn't complete (no closing boundary) is deleted by v0.2.3 anyway.
 * What doesn't survive: iOS cancels a background transfer when the app is
 * swiped away, and Android stops with the app if it is force-stopped.
 */
import { Platform } from 'react-native'
import { File, FileMode, Paths, UploadTask, UploadType } from 'expo-file-system'
import { httpErrorMessage, keyHeaders } from '../api/board'
import { isDemoBase } from '../api/demoBoard'
import { isNewer } from './version'

export const BATCH_UPLOAD_MIN_FW = 'v0.2.3'

/** Can this table take a whole sync in one upload (and does this platform do it in the background)? */
// Not the demo table (App Review's): it reports v99 but has no HTTP server to send to, so it
// takes the per-file path, whose uploads its stand-in board answers.
export function supportsBatchUpload(fw: string | null | undefined, base: string | null | undefined): boolean {
  return !!fw && !!base && !isDemoBase(base) && Platform.OS !== 'web' && !isNewer(BATCH_UPLOAD_MIN_FW, fw)
}

export interface BatchFile {
  /** The file's path under /patterns (its bare name for hub patterns). */
  key: string
  /** Where its bytes are on the phone. */
  uri: string
}

/**
 * Writes the request body; `ends[i]` = the byte offset where file i's part ends.
 * onFile(i) before each file; it yields to the JS loop between files, so progress
 * renders and the app stays responsive however big the batch.
 */
export async function writeBatchBody(files: BatchFile[], boundary: string, onFile: (i: number) => void): Promise<{ body: File; ends: number[]; size: number }> {
  const body = new File(Paths.cache, `hub-sync-${Date.now()}.bin`)
  if (body.exists) body.delete()
  body.create()
  const enc = new TextEncoder()
  const out = body.open(FileMode.Truncate)
  const ends: number[] = []
  let size = 0
  const put = (bytes: Uint8Array) => {
    out.writeBytesSync(bytes)
    size += bytes.length
  }
  try {
    for (const [i, f] of files.entries()) {
      onFile(i)
      await new Promise((r) => setTimeout(r, 0))
      const bytes = new File(f.uri).bytesSync()
      const path = `/patterns/${f.key}`
      put(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${path}"; filename="${path}"\r\nContent-Type: application/octet-stream\r\n\r\n`))
      put(bytes)
      put(enc.encode('\r\n'))
      ends.push(size)
    }
    put(enc.encode(`--${boundary}--\r\n`))
  } finally {
    out.close()
  }
  return { body, ends, size }
}

/**
 * POSTs the body to the table's /upload. onProgress gets the bytes sent (the
 * table writes each file as it arrives). Resolves when the table has answered
 * 200 for the whole request; throws its reason otherwise (or AbortError).
 */
export async function sendBatch(base: string, body: File, boundary: string, onProgress: (sent: number) => void, signal: AbortSignal): Promise<void> {
  const task = new UploadTask(body, `${base}/upload?dontlist=yes`, {
    httpMethod: 'POST',
    uploadType: UploadType.BINARY_CONTENT,
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, ...keyHeaders(base) },
    sessionType: 'background',
    // iOS hands bytesSent over as a BigInt (native Int64; the type says number): mixed into
    // the progress math it threw on every event, so the bar never moved.
    onProgress: (p) => onProgress(Number(p.bytesSent)),
    signal,
  })
  try {
    const r = await task.uploadAsync()
    if (r.status < 200 || r.status >= 300) throw new Error(httpErrorMessage(r.status, r.body ?? ''))
  } finally {
    task.release()
  }
}

/** Which file part a byte offset falls in. */
export function partAt(ends: number[], sent: number): number {
  let i = 0
  while (i < ends.length - 1 && ends[i] <= sent) i++
  return i
}
