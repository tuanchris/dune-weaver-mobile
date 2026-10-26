import React, { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, StyleSheet, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { useTheme } from '../stores/useTheme'
import { LedSim, SIM_FRAME_MS, type SimParams } from '../lib/ledSim'
import type { Dot } from '../lib/ledPreview'

/**
 * The table's LED ring seen from above: one glowing dot per LED around the sand
 * disc, dark dots for unlit LEDs. Pure SVG, no animation (it's a still sketch of
 * the effect — see lib/ledPreview.ts). `children` sit centered in the disc.
 */
export function LedRing({
  dots,
  size,
  brightness = 255,
  glow = true,
  children,
}: {
  dots: Dot[]
  size: number
  /** 0..255; scales how lit the dots look (never fully dark, so dim stays readable). */
  brightness?: number
  /** Soft halo per dot — on for the hero, off for small gallery tiles. */
  glow?: boolean
  children?: React.ReactNode
}): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const n = dots.length
  const c = size / 2
  // Dot size from the gap between neighbours, so 12 or 72 LEDs both read as a ring.
  const dotR = Math.max(1.5, Math.min(size * 0.045, (Math.PI * size * 0.84) / n / 2.6))
  const ringR = c - dotR * (glow ? 2.2 : 1.4)
  const level = 0.35 + 0.65 * (Math.max(0, Math.min(255, brightness)) / 255)
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {/* The sand disc the ring wraps around. */}
        <Circle cx={c} cy={c} r={ringR - dotR * 2.2} fill={colors.cardElevated} />
        {dots.map((d, i) => {
          const ang = (i / n) * Math.PI * 2 - Math.PI / 2 // index 0 at 12 o'clock
          const x = c + ringR * Math.cos(ang)
          const y = c + ringR * Math.sin(ang)
          if (d.a < 0.04) return <Circle key={i} cx={x} cy={y} r={dotR * 0.8} fill={colors.border} />
          return (
            <React.Fragment key={i}>
              {glow ? <Circle cx={x} cy={y} r={dotR * 2} fill={d.c} opacity={0.22 * d.a * level} /> : null}
              <Circle cx={x} cy={y} r={dotR} fill={d.c} opacity={(0.2 + 0.8 * d.a) * level} />
            </React.Fragment>
          )
        })}
      </Svg>
      {children ? <View style={styles.center} pointerEvents="box-none">{children}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
})

/** The system Reduce Motion setting (live). */
export function useReduceMotion(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let live = true
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (live) setOn(v) }).catch(() => {})
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setOn)
    return () => {
      live = false
      sub.remove()
    }
  }, [])
  return on
}

// ONE clock for every animated ring on screen: a single requestAnimationFrame
// loop counts firmware frames and calls every subscriber from the same callback,
// so React batches all their updates into one render — a gallery of rings costs
// one render a frame, not one per ring.
type Tick = (frames: number) => void
const tickers = new Set<Tick>()
let raf = 0
let last = 0
let acc = 0
function loop() {
  const now = Date.now()
  acc += now - last
  last = now
  let frames = Math.floor(acc / SIM_FRAME_MS)
  if (frames > 0) {
    acc -= frames * SIM_FRAME_MS
    if (frames > 4) {
      // Back from a stall (JS busy, app paused): don't fast-forward through it.
      frames = 4
      acc = 0
    }
    tickers.forEach((t) => t(frames))
  }
  raf = requestAnimationFrame(loop)
}
function subscribe(t: Tick): () => void {
  tickers.add(t)
  if (tickers.size === 1) {
    last = Date.now()
    acc = SIM_FRAME_MS // draw on the first tick
    raf = requestAnimationFrame(loop)
  }
  return () => {
    tickers.delete(t)
    if (tickers.size === 0) cancelAnimationFrame(raf)
  }
}

/**
 * The ring, animated by the firmware's own effect code (lib/ledSim.ts), like
 * WLED's live view — but simulated on the phone, since the table's
 * single-threaded web server can't stream frames. The simulation steps every
 * firmware frame (timing stays true); `every` draws only every Nth one, for
 * small rings shown many at a time. When `animate` is false (Reduce Motion, the
 * tab hidden, the strip off, scrolled out of view) it shows `still`, a sketch of
 * the effect, instead of a frozen mid-animation frame.
 */
export function AnimatedLedRing({
  params,
  count,
  leds = count,
  animate,
  still,
  every = 1,
  ...ring
}: {
  params: SimParams
  /** Dots drawn. */
  count: number
  /** LEDs simulated — the strip's real length, so motion keeps its real pace
   * however many dots are drawn (they pool it). Defaults to `count`. */
  leds?: number
  animate: boolean
  still: Dot[]
  every?: number
  size: number
  brightness?: number
  glow?: boolean
  children?: React.ReactNode
}): React.JSX.Element {
  const simRef = useRef<LedSim | null>(null)
  if (!simRef.current || simRef.current.n !== leds) simRef.current = new LedSim(leds)
  const paramsRef = useRef(params)
  paramsRef.current = params
  const [dots, setDots] = useState<Dot[] | null>(null)

  useEffect(() => {
    if (!animate) {
      setDots(null)
      return
    }
    let skipped = every // draw on the first tick
    return subscribe((frames) => {
      const sim = simRef.current!
      for (let k = 0; k < frames; k++) sim.frame(paramsRef.current)
      skipped += frames
      if (skipped >= every) {
        skipped = 0
        setDots(sim.dots(count))
      }
    })
  }, [animate, count, leds, every])

  return <LedRing dots={animate && dots ? dots : still} {...ring} />
}

/** Firmware frames elapsed on the shared clock while `active` (redrawn every
 * `every` frames) — for things that move with the LEDs but aren't a ring, like
 * the flowing palette swatches. */
export function useLedClock(active: boolean, every = 2): number {
  const [frames, setFrames] = useState(0)
  const total = useRef(0)
  useEffect(() => {
    if (!active) return
    let skipped = every
    return subscribe((f) => {
      total.current += f
      skipped += f
      if (skipped >= every) {
        skipped = 0
        setFrames(total.current)
      }
    })
  }, [active, every])
  return frames
}
