// WLED effects, ported from WLED v0.15.3 wled00/FX.cpp (EUPL-1.2, redistributed
// under GPLv3 per its Article 5). A line-for-line mirror of the firmware's
// FluidNC/src/WledFx/fx_e.cpp; tools/fx_parity.py (firmware repo) checks them.
//
// Batch e: Halloween Eyes, Fireworks Starburst, Fireworks 1D, Sinelon Dual,
// Sinelon Rainbow, Popcorn, Percent, Ripple Rainbow, Candle Multi, Solid Glitter.
import {
  BLACK, CRGB, FRAMETIME, MAX, NUM_COLORS, PALETTE_SOLID_WRAP, SEGCOLOR, SEGLEN, SEGMENT, ULTRAWHITE, WHITE, beatsin16_t,
  color_blend, constrain, cubicwave8, div, f32, ftoi, indexToVStrip, map, mode_static, qadd8, qsub8, random16, random8, roundf,
  scale8, sin8_t, sqrtf, strip, triwave8, u16, u32, u8,
} from './shim'

// WLED FX.h / FX.cpp constants the shim does not carry. One segment here, and
// allocateData caps it at 4096 bytes: that whole cap is its fair share.
const FAIR_DATA_PER_SEG = 4096
const FRAMETIME_FIXED = div(1000, 42)
const IBN = 5100

// SEGENV.data struct fields (little-endian, C layout)
const getF = (o: number): number => SEGMENT.dataView!.getFloat32(o, true)
const setF = (o: number, v: number): void => SEGMENT.dataView!.setFloat32(o, v, true)
const getU16 = (o: number): number => SEGMENT.dataView!.getUint16(o, true)
const setU16 = (o: number, v: number): void => SEGMENT.dataView!.setUint16(o, v, true)
const getU32 = (o: number): number => SEGMENT.dataView!.getUint32(o, true)
const setU32 = (o: number, v: number): void => SEGMENT.dataView!.setUint32(o, v, true)

// struct Spark (20 bytes): float pos @0, posX @4, vel @8, velX @12; uint16 col @16; uint8 colIndex @18
const SPARK = 20
const SP_POS = 0, SP_POSX = 4, SP_VEL = 8, SP_VELX = 12, SP_COL = 16, SP_COLINDEX = 18

// ---- Halloween Eyes -------------------------------------------------------------
// SEGMENT.offset (WLED reuses it on matrices): the shim's Segment has none.
let eyes_offset = 0

export function mode_halloween_eyes(): number {
  // enum eyeState : uint8_t
  const initializeOn = 0, on = 1, blink = 2, initializeOff = 3, off = 4, count = 5
  // struct EyeData (16 bytes): uint8 state @0, uint8 color @1, uint16 startPos @2, uint16 duration @4,
  // uint32 startTime @8, uint32 blinkEndTime @12
  const D_STATE = 0, D_COLOR = 1, D_STARTPOS = 2, D_DURATION = 4, D_STARTTIME = 8, D_BLINKEND = 12

  if (SEGLEN() === 1) return mode_static()
  const maxWidth = strip.isMatrix ? SEGMENT.virtualWidth() : SEGLEN()
  const HALLOWEEN_EYE_SPACE = MAX(2, strip.isMatrix ? SEGMENT.virtualWidth() >> 4 : SEGLEN() >> 5)
  const HALLOWEEN_EYE_WIDTH = HALLOWEEN_EYE_SPACE >>> 1
  const eyeLength = 2 * HALLOWEEN_EYE_WIDTH + HALLOWEEN_EYE_SPACE
  if (eyeLength >= maxWidth) return mode_static() //bail if segment too short

  if (!SEGMENT.allocateData(16)) return mode_static() //allocation failed
  const data = SEGMENT.data!

  if (!SEGMENT.check2) SEGMENT.fill(SEGCOLOR(1)) //fill background

  data[D_STATE] = data[D_STATE] % count
  let duration = Math.max(1, getU16(D_DURATION))
  const elapsedTime = u32(strip.now - getU32(D_STARTTIME))

  switch (data[D_STATE]) {
    case initializeOn: {
      setU16(D_STARTPOS, random16(0, maxWidth - eyeLength - 1))
      data[D_COLOR] = random8()
      if (strip.isMatrix) eyes_offset = random16(SEGMENT.virtualHeight() - 1) // a hack: reuse offset since it is not used in matrices
      duration = 128 + random16(SEGMENT.intensity * 64)
      setU16(D_DURATION, duration)
      data[D_STATE] = on
    }
    // falls through
    case on: {
      const startPos = getU16(D_STARTPOS)
      const start2ndEye = startPos + HALLOWEEN_EYE_WIDTH + HALLOWEEN_EYE_SPACE
      // If the user reduces the input while in this state, limit the duration.
      duration = Math.min(duration, 128 + SEGMENT.intensity * 64)

      const minimumOnTimeBegin = 1024
      const minimumOnTimeEnd = 1024
      const fadeInAnimationState = Math.floor(u32(elapsedTime * (256 * 8)) / duration)
      const backgroundColor = SEGCOLOR(1)
      const eyeColor = SEGMENT.color_from_palette(data[D_COLOR], false, false, 0)
      let c = eyeColor
      if (fadeInAnimationState < 256) {
        c = color_blend(backgroundColor, eyeColor, fadeInAnimationState)
      } else if (elapsedTime > minimumOnTimeBegin) {
        const remainingTime = elapsedTime >= duration ? 0 : duration - elapsedTime
        if (remainingTime > minimumOnTimeEnd) {
          if (random8() < 4) {
            c = backgroundColor
            data[D_STATE] = blink
            setU32(D_BLINKEND, u32(strip.now + random8(8, 128)))
          }
        }
      }

      if (c !== backgroundColor) {
        // render eyes
        for (let i = 0; i < HALLOWEEN_EYE_WIDTH; i++) {
          if (strip.isMatrix) {
            SEGMENT.setPixelColorXY(startPos + i, eyes_offset, c)
            SEGMENT.setPixelColorXY(start2ndEye + i, eyes_offset, c)
          } else {
            SEGMENT.setPixelColor(startPos + i, c)
            SEGMENT.setPixelColor(start2ndEye + i, c)
          }
        }
      }
      break
    }
    case blink: {
      if (strip.now >= getU32(D_BLINKEND)) data[D_STATE] = on
      break
    }
    case initializeOff: {
      const eyeOffTimeBase = SEGMENT.speed * 128
      duration = eyeOffTimeBase + random16(eyeOffTimeBase)
      setU16(D_DURATION, duration)
      data[D_STATE] = off
    }
    // falls through
    case off: {
      // If the user reduces the input while in this state, limit the duration.
      const eyeOffTimeBase = SEGMENT.speed * 128
      duration = Math.min(duration, 2 * eyeOffTimeBase)
      break
    }
    case count: {
      // Can't happen, not an actual state.
      data[D_STATE] = initializeOn
      break
    }
  }

  if (elapsedTime > duration) {
    // The current state duration is over, switch to the next state.
    switch (data[D_STATE]) {
      case initializeOn:
      case on:
      case blink:
        data[D_STATE] = initializeOff
        break
      default:
        data[D_STATE] = initializeOn
        break
    }
    setU32(D_STARTTIME, strip.now)
  }

  return FRAMETIME
}

// ---- Fireworks Starburst ----------------------------------------------------------
const STARBURST_MAX_FRAG = 10
// struct particle / star (60 bytes): CRGB color @0; uint32 birth @4, last @8; float vel @12;
// uint16 pos @16; float fragment[10] @20
const STAR = 20 + STARBURST_MAX_FRAG * 4
const ST_BIRTH = 4, ST_LAST = 8, ST_VEL = 12, ST_POS = 16, ST_FRAG = 20

export function mode_starburst(): number {
  if (SEGLEN() === 1) return mode_static()
  let maxData = FAIR_DATA_PER_SEG //ESP8266: 256 ESP32: 640
  const segs = strip.getActiveSegmentsNum()
  if (segs <= div(strip.getMaxSegments(), 2)) maxData *= 2
  if (segs <= div(strip.getMaxSegments(), 4)) maxData *= 2
  const maxStars = Math.floor(maxData / STAR)

  let numStars = 1 + (SEGLEN() >> 3)
  if (numStars > maxStars) numStars = maxStars
  const dataSize = STAR * numStars

  if (!SEGMENT.allocateData(dataSize)) return mode_static() //allocation failed

  const it = strip.now

  const data = SEGMENT.data!

  const maxSpeed = f32(375.0) // Max velocity
  const particleIgnition = f32(250.0) // How long to "flash"
  const particleFadeTime = f32(1500.0) // Fade out time

  for (let j = 0; j < numStars; j++) {
    const o = j * STAR
    // speed to adjust chance of a burst, max is nearly always.
    if (random8(144 - (SEGMENT.speed >> 1)) === 0 && getU32(o + ST_BIRTH) === 0) {
      // Pick a random color and location.
      const startPos = random16(SEGLEN() - 1)
      const multiplier = f32(f32(random8() / 255.0) * 1.0)

      const col = new CRGB(SEGMENT.color_wheel(random8()))
      data[o] = col.r; data[o + 1] = col.g; data[o + 2] = col.b
      setU16(o + ST_POS, startPos)
      setF(o + ST_VEL, f32(f32(f32(maxSpeed * random8()) / 255.0) * multiplier))
      setU32(o + ST_BIRTH, it)
      setU32(o + ST_LAST, it)
      // more fragments means larger burst effect
      const num = random8(3, 6 + (SEGMENT.intensity >> 5))

      for (let i = 0; i < STARBURST_MAX_FRAG; i++) {
        if (i < num) setF(o + ST_FRAG + 4 * i, startPos)
        else setF(o + ST_FRAG + 4 * i, -1)
      }
    }
  }

  if (!SEGMENT.check2) SEGMENT.fill(SEGCOLOR(1))

  for (let j = 0; j < numStars; j++) {
    const o = j * STAR
    if (getU32(o + ST_BIRTH) !== 0) {
      const dt = f32(u32(it - getU32(o + ST_LAST)) / 1000.0) // a double division, rounded to float

      for (let i = 0; i < STARBURST_MAX_FRAG; i++) {
        const v = i >> 1

        const frag = getF(o + ST_FRAG + 4 * i)
        if (frag > 0) {
          //all fragments travel right, will be mirrored on other side
          // `frag += vel * dt * (float)var / 3.0`: float product, then double math, stored as float
          setF(o + ST_FRAG + 4 * i, frag + f32(f32(getF(o + ST_VEL) * dt) * v) / 3.0)
        }
      }
      setU32(o + ST_LAST, it)
      const vel = getF(o + ST_VEL)
      setF(o + ST_VEL, f32(vel - f32(f32(3 * vel) * dt)))
    }

    const c = new CRGB(data[o], data[o + 1], data[o + 2])

    // If the star is brand new, it flashes white briefly.
    // Otherwise it just fades over time.
    let fade = f32(0.0)
    let age = f32(u32(it - getU32(o + ST_BIRTH)))

    if (age < particleIgnition) {
      c.set(color_blend(WHITE, c.u32(), u16(ftoi(f32(254.5 * f32(age / particleIgnition))))))
    } else {
      // Figure out how much to fade and shrink the star based on
      // its age relative to its lifetime
      if (age > f32(particleIgnition + particleFadeTime)) {
        fade = f32(1.0) // Black hole, all faded out
        setU32(o + ST_BIRTH, 0)
        c.set(SEGCOLOR(1))
      } else {
        age = f32(age - particleIgnition)
        fade = f32(age / particleFadeTime) // Fading star
        const f = u8(ftoi(f32(254.5 * fade)))
        c.set(color_blend(c.u32(), SEGCOLOR(1), f))
      }
    }

    const particleSize = f32(f32(1.0 - fade) * 2.0)

    for (let index = 0; index < STARBURST_MAX_FRAG * 2; index++) {
      const mirrored = (index & 0x1) !== 0
      const i = index >> 1
      if (getF(o + ST_FRAG + 4 * i) > 0) {
        let loc = getF(o + ST_FRAG + 4 * i)
        if (mirrored) loc = f32(loc - f32(f32(loc - getU16(o + ST_POS)) * 2))
        let start = ftoi(f32(loc - particleSize))
        let end = ftoi(f32(loc + particleSize))
        if (start < 0) start = 0
        if (start === end) end++
        if (end > SEGLEN()) end = SEGLEN()
        for (let p = start; p < end; p++) {
          SEGMENT.setPixelColor(p, c.r, c.g, c.b)
        }
      }
    }
  }
  return FRAMETIME
}

// ---- Fireworks 1D -----------------------------------------------------------------
export function mode_exploding_fireworks(): number {
  if (SEGLEN() === 1) return mode_static()
  const cols = SEGMENT.is2D() ? SEGMENT.virtualWidth() : 1
  const rows = SEGMENT.is2D() ? SEGMENT.virtualHeight() : SEGMENT.virtualLength()

  //allocate segment data
  let maxData = FAIR_DATA_PER_SEG //ESP8266: 256 ESP32: 640
  const segs = strip.getActiveSegmentsNum()
  if (segs <= div(strip.getMaxSegments(), 2)) maxData *= 2
  if (segs <= div(strip.getMaxSegments(), 4)) maxData *= 2
  const maxSparks = Math.floor(maxData / SPARK)

  const numSparks = Math.min(5 + ((rows * cols) >> 1), maxSparks)
  const dataSize = SPARK * numSparks
  if (!SEGMENT.allocateData(dataSize + 4)) return mode_static() //allocation failed
  const DYING = dataSize // float *dying_gravity = data + dataSize

  if (dataSize !== SEGMENT.aux1) { //reset to flare if sparks were reallocated
    setF(DYING, 0.0)
    SEGMENT.aux0 = 0
    SEGMENT.aux1 = u16(dataSize)
  }

  SEGMENT.fade_out(252)

  const F = 0 //first spark is flare data

  let gravity = f32(f32(-0.0004) - f32(SEGMENT.speed / 800000.0)) // m/s/s
  gravity = f32(gravity * rows)

  if (SEGMENT.aux0 < 2) { //FLARE
    if (SEGMENT.aux0 === 0) { //init flare
      setF(F + SP_POS, 0)
      setF(F + SP_POSX, SEGMENT.is2D() ? random16(2, cols - 3) : SEGMENT.intensity > random8() ? 1 : 0) // will enable random firing side on 1D
      let peakHeight = 75 + random8(180) //0-255
      peakHeight = u32(peakHeight * (rows - 1)) >>> 8
      setF(F + SP_VEL, sqrtf(f32(f32(-2.0 * gravity) * peakHeight)))
      setF(F + SP_VELX, SEGMENT.is2D() ? f32((random8(9) - 4) / 64.0) : 0) // no X velocity on 1D
      setU16(F + SP_COL, 255) //brightness
      SEGMENT.aux0 = 1
    }

    // launch
    if (getF(F + SP_VEL) > f32(12 * gravity)) {
      // flare
      const fc = getU16(F + SP_COL)
      if (SEGMENT.is2D()) SEGMENT.setPixelColorXY(u32(ftoi(getF(F + SP_POSX))), rows - u16(ftoi(getF(F + SP_POS))) - 1, fc, fc, fc)
      else SEGMENT.setPixelColor(getF(F + SP_POSX) > 0.0 ? rows - ftoi(getF(F + SP_POS)) - 1 : ftoi(getF(F + SP_POS)), fc, fc, fc)
      setF(F + SP_POS, f32(getF(F + SP_POS) + getF(F + SP_VEL)))
      setF(F + SP_POS, constrain(getF(F + SP_POS), 0, rows - 1))
      if (SEGMENT.is2D()) {
        setF(F + SP_POSX, f32(getF(F + SP_POSX) + getF(F + SP_VELX)))
        setF(F + SP_POSX, constrain(getF(F + SP_POSX), 0, cols - 1))
      }
      setF(F + SP_VEL, f32(getF(F + SP_VEL) + gravity))
      setU16(F + SP_COL, u16(fc - 2))
    } else {
      SEGMENT.aux0 = 2 // ready to explode
    }
  } else if (SEGMENT.aux0 < 4) {
    /*
     * Explode!
     *
     * Explosion happens where the flare ended.
     * Size is proportional to the height.
     */
    let nSparks = ftoi(f32(getF(F + SP_POS) + random8(4)))
    nSparks = Math.max(nSparks, 4) // This is not a standard constrain; numSparks is not guaranteed to be at least 4
    nSparks = Math.min(nSparks, numSparks)

    // initialize sparks
    if (SEGMENT.aux0 === 2) {
      const flarePos = getF(F + SP_POS), flarePosX = getF(F + SP_POSX)
      for (let i = 1; i < nSparks; i++) {
        const o = i * SPARK
        setF(o + SP_POS, flarePos)
        setF(o + SP_POSX, flarePosX)
        let vel = f32(f32(random16(20001) / 10000.0) - f32(0.9)) // from -0.9 to 1.1
        vel = f32(vel * (rows < 32 ? 0.5 : 1)) // reduce velocity for smaller strips
        let velX = SEGMENT.is2D() ? f32(f32(random16(20001) / 10000.0) - 1.0) : 0 // from -1 to 1
        setU16(o + SP_COL, 345)
        SEGMENT.data![o + SP_COLINDEX] = random8()
        vel = f32(vel * f32(flarePos / rows)) // proportional to height
        velX = f32(velX * (SEGMENT.is2D() ? f32(flarePosX / cols) : 0)) // proportional to width
        vel = f32(vel * f32(-gravity * 50))
        setF(o + SP_VEL, vel)
        setF(o + SP_VELX, velX)
      }
      setF(DYING, f32(gravity / 2))
      SEGMENT.aux0 = 3
    }

    if (getU16(SPARK + SP_COL) > 4) { // as long as our known spark is lit, work with all the sparks
      const dying = getF(DYING)
      for (let i = 1; i < nSparks; i++) {
        const o = i * SPARK
        setF(o + SP_POS, f32(getF(o + SP_POS) + getF(o + SP_VEL)))
        setF(o + SP_POSX, f32(getF(o + SP_POSX) + getF(o + SP_VELX)))
        setF(o + SP_VEL, f32(getF(o + SP_VEL) + dying))
        setF(o + SP_VELX, f32(getF(o + SP_VELX) + (SEGMENT.is2D() ? dying : 0)))
        if (getU16(o + SP_COL) > 3) setU16(o + SP_COL, getU16(o + SP_COL) - 4)

        const pos = getF(o + SP_POS), posX = getF(o + SP_POSX)
        if (pos > 0 && pos < rows) {
          if (SEGMENT.is2D() && !(posX >= 0 && posX < cols)) continue
          const prog = getU16(o + SP_COL)
          const spColor = SEGMENT.palette ? SEGMENT.color_wheel(SEGMENT.data![o + SP_COLINDEX]) : SEGCOLOR(0)
          const c = new CRGB(CRGB.Black)
          if (prog > 300) { //fade from white to spark color
            c.set(color_blend(spColor, WHITE, (prog - 300) * 5))
          } else if (prog > 45) { //fade from spark color to black
            c.set(color_blend(BLACK, spColor, prog - 45))
            const cooling = (300 - prog) >> 5
            c.g = qsub8(c.g, cooling)
            c.b = qsub8(c.b, cooling * 2)
          }
          if (SEGMENT.is2D()) SEGMENT.setPixelColorXY(ftoi(posX), rows - ftoi(pos) - 1, c.red, c.green, c.blue)
          else SEGMENT.setPixelColor(ftoi(posX) ? rows - ftoi(pos) - 1 : ftoi(pos), c.red, c.green, c.blue)
        }
      }
      if (SEGMENT.check3) SEGMENT.blur(16)
      setF(DYING, f32(getF(DYING) * f32(0.8))) // as sparks burn out they fall slower
    } else {
      SEGMENT.aux0 = 6 + random8(10) //wait for this many frames
    }
  } else {
    SEGMENT.aux0 = u16(SEGMENT.aux0 - 1)
    if (SEGMENT.aux0 < 4) {
      SEGMENT.aux0 = 0 //back to flare
    }
  }

  return FRAMETIME
}

// ---- Sinelon Dual / Sinelon Rainbow ---------------------------------------------------
function sinelon_base(dual: boolean, rainbow = false): number {
  if (SEGLEN() === 1) return mode_static()
  SEGMENT.fade_out(SEGMENT.intensity)
  const pos = beatsin16_t(div(SEGMENT.speed, 10), 0, SEGLEN() - 1)
  if (SEGMENT.call === 0) SEGMENT.aux0 = pos
  let color1 = SEGMENT.color_from_palette(pos, true, false, 0)
  let color2 = SEGCOLOR(2)
  if (rainbow) {
    color1 = SEGMENT.color_wheel((pos & 0x07) * 32)
  }
  SEGMENT.setPixelColor(pos, color1)
  if (dual) {
    if (!color2) color2 = SEGMENT.color_from_palette(pos, true, false, 0)
    if (rainbow) color2 = color1 //rainbow
    SEGMENT.setPixelColor(SEGLEN() - 1 - pos, color2)
  }
  if (SEGMENT.aux0 !== pos) {
    if (SEGMENT.aux0 < pos) {
      for (let i = SEGMENT.aux0; i < pos; i++) {
        SEGMENT.setPixelColor(i, color1)
        if (dual) SEGMENT.setPixelColor(SEGLEN() - 1 - i, color2)
      }
    } else {
      for (let i = SEGMENT.aux0; i > pos; i--) {
        SEGMENT.setPixelColor(i, color1)
        if (dual) SEGMENT.setPixelColor(SEGLEN() - 1 - i, color2)
      }
    }
    SEGMENT.aux0 = pos
  }

  return FRAMETIME
}

export function mode_sinelon_dual(): number {
  return sinelon_base(true)
}

export function mode_sinelon_rainbow(): number {
  return sinelon_base(false, true)
}

// ---- Solid Glitter ------------------------------------------------------------------
// utility function that will add random glitter to SEGMENT
function glitter_base(intensity: number, col = ULTRAWHITE): void {
  if (u8(intensity) > random8()) SEGMENT.setPixelColor(random16(SEGLEN()), col)
}

//Solid colour background with glitter (can be replaced by Glitter)
export function mode_solid_glitter(): number {
  SEGMENT.fill(SEGCOLOR(0))
  glitter_base(SEGMENT.intensity, SEGCOLOR(2) ? SEGCOLOR(2) : ULTRAWHITE)
  return FRAMETIME
}

// ---- Popcorn ------------------------------------------------------------------------
const maxNumPopcorn = 21 // max 21 on 16 segment ESP8266

export function mode_popcorn(): number {
  if (SEGLEN() === 1) return mode_static()
  //allocate segment data
  const strips = SEGMENT.nrOfVStrips()
  let usablePopcorns = maxNumPopcorn
  if (usablePopcorns * strips * SPARK > FAIR_DATA_PER_SEG) usablePopcorns = Math.floor(FAIR_DATA_PER_SEG / (strips * SPARK)) + 1 // at least 1 popcorn per vstrip
  const dataSize = SPARK * usablePopcorns
  if (!SEGMENT.allocateData(dataSize * strips)) return mode_static() //allocation failed

  const hasCol2 = SEGCOLOR(2) !== 0
  if (!SEGMENT.check2) SEGMENT.fill(hasCol2 ? BLACK : SEGCOLOR(1))

  for (let stripNr = 0; stripNr < strips; stripNr++) popcornRunStrip(stripNr, stripNr * usablePopcorns * SPARK, usablePopcorns)

  return FRAMETIME
}

// struct virtualStrip::runStrip; `base` = byte offset of &popcorn[stripNr * usablePopcorns]
function popcornRunStrip(stripNr: number, base: number, usablePopcorns: number): void {
  const data = SEGMENT.data!
  let gravity = f32(f32(-0.0001) - f32(SEGMENT.speed / 200000.0)) // m/s/s
  gravity = f32(gravity * SEGLEN())

  let numPopcorn = Math.floor((SEGMENT.intensity * usablePopcorns) / 255)
  if (numPopcorn === 0) numPopcorn = 1

  for (let i = 0; i < numPopcorn; i++) {
    const o = base + i * SPARK
    if (getF(o + SP_POS) >= 0.0) { // if kernel is active, update its position
      setF(o + SP_POS, f32(getF(o + SP_POS) + getF(o + SP_VEL)))
      setF(o + SP_VEL, f32(getF(o + SP_VEL) + gravity))
    } else { // if kernel is inactive, randomly pop it
      if (random8() < 2) { // POP!!!
        setF(o + SP_POS, f32(0.01))

        let peakHeight = 128 + random8(128) //0-255
        peakHeight = u32(peakHeight * (SEGLEN() - 1)) >>> 8
        setF(o + SP_VEL, sqrtf(f32(f32(-2.0 * gravity) * peakHeight)))

        if (SEGMENT.palette) {
          data[o + SP_COLINDEX] = random8()
        } else {
          let col = random8(0, NUM_COLORS)
          if (!SEGCOLOR(2) || !SEGCOLOR(col)) col = 0
          data[o + SP_COLINDEX] = col
        }
      }
    }
    if (getF(o + SP_POS) >= 0.0) { // draw now active popcorn (either active before or just popped)
      const colIndex = data[o + SP_COLINDEX]
      let col = SEGMENT.color_wheel(colIndex)
      if (!SEGMENT.palette && colIndex < NUM_COLORS) col = SEGCOLOR(colIndex)
      const ledIndex = u32(ftoi(getF(o + SP_POS)))
      if (ledIndex < SEGLEN()) SEGMENT.setPixelColor(indexToVStrip(ledIndex, stripNr), col)
    }
  }
}

// ---- Percent ------------------------------------------------------------------------
export function mode_percent(): number {
  let percent = SEGMENT.intensity
  percent = constrain(percent, 0, 200)
  const active_leds = u32(ftoi(percent < 100 ? roundf(f32((SEGLEN() * percent) / 100.0)) : roundf(f32((SEGLEN() * (200 - percent)) / 100.0))))

  let size = 1 + ((SEGMENT.speed * SEGLEN()) >> 11)
  if (SEGMENT.speed === 255) size = 255

  if (percent <= 100) {
    for (let i = 0; i < SEGLEN(); i++) {
      if (i < SEGMENT.aux1) {
        if (SEGMENT.check1) SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(map(percent, 0, 100, 0, 255), false, false, 0))
        else SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 0))
      } else {
        SEGMENT.setPixelColor(i, SEGCOLOR(1))
      }
    }
  } else {
    for (let i = 0; i < SEGLEN(); i++) {
      if (i < SEGLEN() - SEGMENT.aux1) {
        SEGMENT.setPixelColor(i, SEGCOLOR(1))
      } else {
        if (SEGMENT.check1) SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(map(percent, 100, 200, 255, 0), false, false, 0))
        else SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 0))
      }
    }
  }

  if (active_leds > SEGMENT.aux1) { // smooth transition to the target value
    SEGMENT.aux1 = u16(SEGMENT.aux1 + size)
    if (SEGMENT.aux1 > active_leds) SEGMENT.aux1 = u16(active_leds)
  } else if (active_leds < SEGMENT.aux1) {
    if (SEGMENT.aux1 > size) SEGMENT.aux1 = u16(SEGMENT.aux1 - size)
    else SEGMENT.aux1 = 0
    if (SEGMENT.aux1 < active_leds) SEGMENT.aux1 = u16(active_leds)
  }

  return FRAMETIME
}

// ---- Ripple Rainbow -------------------------------------------------------------------
const MAX_RIPPLES = 100
// struct Ripple (4 bytes): uint8 state @0, uint8 color @1, uint16 pos @2
function ripple_base(): number {
  const maxRipples = Math.min(1 + (SEGLEN() >> 2), MAX_RIPPLES) // 56 max for 16 segment ESP8266
  const dataSize = 4 * maxRipples

  if (!SEGMENT.allocateData(dataSize)) return mode_static() //allocation failed

  const data = SEGMENT.data!

  //draw wave
  for (let i = 0; i < maxRipples; i++) {
    const o = i * 4
    let ripplestate = data[o]
    if (ripplestate) {
      const rippledecay = (SEGMENT.speed >> 4) + 1 //faster decay if faster propagation
      const rippleorigin = getU16(o + 2)
      const col = SEGMENT.color_from_palette(data[o + 1], false, false, 255)
      // unsigned: (0 - 1) wraps, as in C
      const propagation = u32(u32(Math.floor(ripplestate / rippledecay) - 1) * (SEGMENT.speed + 1))
      let propI = propagation >>> 8
      const propF = propagation & 0xff
      const amp = ripplestate < 17 ? triwave8((ripplestate - 1) * 8) : map(ripplestate, 17, 255, 255, 2)

      if (SEGMENT.is2D()) {
        propI = div(propI, 2)
        const cx = rippleorigin >> 8
        const cy = rippleorigin & 0xff
        const mag = scale8(sin8_t(propF >> 2), amp)
        if (propI > 0) SEGMENT.drawCircle(cx, cy, propI, color_blend(SEGMENT.getPixelColorXY(cx + propI, cy), col, mag), true)
      } else {
        const left = rippleorigin - propI - 1
        const right = rippleorigin + propI + 2
        for (let v = 0; v < 4; v++) {
          const mag = scale8(cubicwave8((propF >> 2) + v * 64), amp)
          SEGMENT.setPixelColor(left + v, color_blend(SEGMENT.getPixelColor(left + v), col, mag)) // TODO
          SEGMENT.setPixelColor(right - v, color_blend(SEGMENT.getPixelColor(right - v), col, mag)) // TODO
        }
      }
      ripplestate += rippledecay
      data[o] = ripplestate > 254 ? 0 : ripplestate
    } else { //randomly create new wave
      if (random16(IBN + 10000) <= SEGMENT.intensity >> ((SEGMENT.is2D() ? 1 : 0) * 3)) {
        data[o] = 1
        if (SEGMENT.is2D()) {
          const rx = random8(SEGMENT.virtualWidth()) // sequenced, as in the C++
          setU16(o + 2, (rx << 8) | random8(SEGMENT.virtualHeight()))
        } else {
          setU16(o + 2, random16(SEGLEN()))
        }
        data[o + 1] = random8() //color
      }
    }
  }

  return FRAMETIME
}

export function mode_ripple_rainbow(): number {
  if (SEGLEN() === 1) return mode_static()
  if (SEGMENT.call === 0) {
    SEGMENT.aux0 = random8()
    SEGMENT.aux1 = random8()
  }
  if (SEGMENT.aux0 === SEGMENT.aux1) {
    SEGMENT.aux1 = random8()
  } else if (SEGMENT.aux1 > SEGMENT.aux0) {
    SEGMENT.aux0 = u16(SEGMENT.aux0 + 1)
  } else {
    SEGMENT.aux0 = u16(SEGMENT.aux0 - 1)
  }
  SEGMENT.fill(color_blend(SEGMENT.color_wheel(u8(SEGMENT.aux0)), BLACK, 235))
  return ripple_base()
}

// ---- Candle Multi -------------------------------------------------------------------
function candle(multi: boolean): number {
  if (multi && SEGLEN() > 1) {
    //allocate segment data
    const dataSize = Math.max(1, SEGLEN() - 1) * 3 //max. 1365 pixels (ESP8266)
    if (!SEGMENT.allocateData(dataSize)) return candle(false) //allocation failed
  }

  //max. flicker range controlled by intensity
  const valrange = SEGMENT.intensity
  const rndval = valrange >> 1 //max 127

  //step (how much to move closer to target per frame) coarsely set by speed
  let speedFactor = 4
  if (SEGMENT.speed > 252) { //epilepsy
    speedFactor = 1
  } else if (SEGMENT.speed > 99) { //regular candle
    speedFactor = 2
  } else if (SEGMENT.speed > 49) { //slower fade
    speedFactor = 3
  } //else 4 (slowest)

  const numCandles = multi ? SEGLEN() : 1

  for (let i = 0; i < numCandles; i++) {
    let d = 0 //data location

    let s = SEGMENT.aux0, s_target = SEGMENT.aux1, fadeStep = SEGMENT.step
    if (i > 0) {
      const data = SEGMENT.data!
      d = (i - 1) * 3
      s = data[d]; s_target = data[d + 1]; fadeStep = data[d + 2]
    }
    if (fadeStep === 0) { //init vals
      s = 128; s_target = 130 + random8(4); fadeStep = 1
    }

    let newTarget = false
    if (s_target > s) { //fade up
      s = qadd8(s, fadeStep)
      if (s >= s_target) newTarget = true
    } else {
      s = qsub8(s, fadeStep)
      if (s <= s_target) newTarget = true
    }

    if (newTarget) {
      const r1 = random8(rndval) // sequenced, as in the C++
      s_target = r1 + random8(rndval) //between 0 and rndval*2 -2 = 252
      if (s_target < rndval >> 1) s_target = (rndval >> 1) + random8(rndval)
      const offset = 255 - valrange
      s_target += offset

      const dif = s_target > s ? s_target - s : s - s_target

      fadeStep = dif >> speedFactor
      if (fadeStep === 0) fadeStep = 1
    }

    if (i > 0) {
      SEGMENT.setPixelColor(i, color_blend(SEGCOLOR(1), SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 0), s))

      const data = SEGMENT.data!
      data[d] = s; data[d + 1] = s_target; data[d + 2] = fadeStep
    } else {
      for (let j = 0; j < SEGLEN(); j++) {
        SEGMENT.setPixelColor(j, color_blend(SEGCOLOR(1), SEGMENT.color_from_palette(j, true, PALETTE_SOLID_WRAP(), 0), s))
      }

      SEGMENT.aux0 = s; SEGMENT.aux1 = s_target; SEGMENT.step = fadeStep
    }
  }

  return FRAMETIME_FIXED
}

export function mode_candle_multi(): number {
  return candle(true)
}
