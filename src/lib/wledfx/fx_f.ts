// WLED effects, ported from WLED v0.15.3 wled00/FX.cpp (EUPL-1.2, redistributed
// under GPLv3 per its Article 5). A line-for-line mirror of the firmware's
// FluidNC/src/WledFx/fx_f.cpp; tools/fx_parity.py (firmware repo) checks them.
//
// Batch f: Sunrise, Phased, Phased Noise, Twinkleup, Noise Pal, Flow, Chunchun,
// Dancing Shadows, Washing Machine, Blends, TV Simulator, Perlin Move,
// Flow Stripe, Wavesins.
import {
  BLACK, CHSV, CRGB, CRGBPalette16, ColorFromPalette, FRAMETIME, LINEARBLEND, PALETTE_SOLID_WRAP, SEGCOLOR, SEGLEN, SEGMENT, SEGPALETTE,
  beatsin8_t, color_blend, cubicwave8, div, f32, ftoi, gamma8, i16, inoise16, inoise8, map, millis, mode_static, nblendPaletteTowardPalette,
  quadwave8, random16, random16_get_seed, random16_set_seed, random8, sin16_t, sin8_t, strip, triwave16, u16, u32, u8,
} from './shim'

/** (a * b) mod 2^32, as C's unsigned multiply. */
const mulu = (a: number, b: number): number => Math.imul(a, b) >>> 0

// FastLED's CRGBPalette16(const CHSV& c1..c4): an HSV gradient (fill_gradient,
// SHORTEST_HUES) converted to RGB per entry. The shim only has the CRGB
// constructors (an RGB gradient: different colors).
function fill_gradient_hsv(targetArray: CRGB[], startpos: number, startcolor: CHSV, endpos: number, endcolor: CHSV): void {
  startcolor = new CHSV(startcolor.hue, startcolor.sat, startcolor.val)
  endcolor = new CHSV(endcolor.hue, endcolor.sat, endcolor.val)
  if (endpos < startpos) {
    const t = endpos
    const tc = endcolor
    endcolor = startcolor
    endpos = startpos
    startpos = t
    startcolor = tc
  }
  if (endcolor.val === 0 || endcolor.sat === 0) endcolor.hue = startcolor.hue
  if (startcolor.val === 0 || startcolor.sat === 0) startcolor.hue = endcolor.hue
  let huedistance87: number
  const satdistance87 = i16((endcolor.sat - startcolor.sat) * 128)
  const valdistance87 = i16((endcolor.val - startcolor.val) * 128)
  const huedelta8 = u8(endcolor.hue - startcolor.hue)
  if (huedelta8 > 127) {
    // SHORTEST_HUES -> BACKWARD_HUES
    huedistance87 = i16(u8(256 - huedelta8) << 7)
    huedistance87 = i16(-huedistance87)
  } else huedistance87 = i16(huedelta8 << 7) // FORWARD_HUES
  const pixeldistance = u16(endpos - startpos)
  const divisor = pixeldistance ? i16(pixeldistance) : 1
  let huedelta87 = i16(div(huedistance87, divisor))
  let satdelta87 = i16(div(satdistance87, divisor))
  let valdelta87 = i16(div(valdistance87, divisor))
  huedelta87 = i16(huedelta87 * 2)
  satdelta87 = i16(satdelta87 * 2)
  valdelta87 = i16(valdelta87 * 2)
  let hue88 = u16(startcolor.hue << 8)
  let sat88 = u16(startcolor.sat << 8)
  let val88 = u16(startcolor.val << 8)
  for (let i = startpos; i <= endpos; ++i) {
    targetArray[i] = new CRGB(new CHSV(hue88 >> 8, sat88 >> 8, val88 >> 8))
    hue88 = u16(hue88 + huedelta87)
    sat88 = u16(sat88 + satdelta87)
    val88 = u16(val88 + valdelta87)
  }
}

function hsvPalette16(c1: CHSV, c2: CHSV, c3: CHSV, c4: CHSV): CRGBPalette16 {
  const p = new CRGBPalette16()
  const onethird = div(16, 3)
  const twothirds = div(16 * 2, 3)
  const last = 16 - 1
  fill_gradient_hsv(p.entries, 0, c1, onethird, c2)
  fill_gradient_hsv(p.entries, onethird, c2, twothirds, c3)
  fill_gradient_hsv(p.entries, twothirds, c3, last, c4)
  return p
}

// FX.cpp's own helper (not part of the shim)
function tristate_square8(x: number, pulsewidth: number, attdec: number): number {
  x = u8(x)
  let a = 127
  if (x > 127) {
    a = -127
    x = u8(x - 127)
  }

  if (x < attdec) return div(x * a, attdec) // inc to max
  else if (x < pulsewidth - attdec) return a // max
  else if (x < pulsewidth) return div((pulsewidth - x) * a, attdec) // dec to 0
  return 0
}

// ---- Sunrise ----------------------------------------------------------------
export function mode_sunrise(): number {
  if (SEGLEN() === 1) return mode_static()
  //speed 0 - static sun
  //speed 1 - 60: sunrise time in minutes
  //speed 60 - 120 : sunset time in minutes - 60;
  //speed above: "breathing" rise and set
  if (SEGMENT.call === 0 || SEGMENT.speed !== SEGMENT.aux0) {
    SEGMENT.step = millis() //save starting time, millis() because strip.now can change from sync
    SEGMENT.aux0 = SEGMENT.speed
  }

  SEGMENT.fill(BLACK)
  let stage = 0xffff

  let s10SinceStart = Math.floor(u32(millis() - SEGMENT.step) / 100) //tenths of seconds

  if (SEGMENT.speed > 120) {
    //quick sunrise and sunset
    const counter = mulu(strip.now >>> 1, ((SEGMENT.speed - 120) >> 1) + 1)
    stage = triwave16(counter)
  } else if (SEGMENT.speed) {
    //sunrise
    let durMins = SEGMENT.speed
    if (durMins > 60) durMins -= 60
    const s10Target = durMins * 600
    if (s10SinceStart > s10Target) s10SinceStart = s10Target
    stage = u32(map(s10SinceStart, 0, s10Target, 0, 0xffff))
    if (SEGMENT.speed > 60) stage = u32(0xffff - stage) //sunset
  }

  for (let i = 0; i <= div(SEGLEN(), 2); i++) {
    //default palette is Fire
    let c = SEGMENT.color_from_palette(0, false, true, 255) //background

    let wave = triwave16(Math.floor(mulu(i, stage) / SEGLEN()))

    wave = (wave >> 8) + (u32(wave * SEGMENT.intensity) >>> 15)

    if (wave > 240) {
      //clipped, full white sun
      c = SEGMENT.color_from_palette(240, false, true, 255)
    } else {
      //transition
      c = SEGMENT.color_from_palette(wave, false, true, 255)
    }
    SEGMENT.setPixelColor(i, c)
    SEGMENT.setPixelColor(SEGLEN() - i - 1, c)
  }

  return FRAMETIME
}

// ---- Phased / Phased Noise ----------------------------------------------------
// SEGENV.step holds a float (reinterpret_cast<float*>(&SEGENV.step))
const phaseF = new Float32Array(1)
const phaseU = new Uint32Array(phaseF.buffer)

function phased_base(moder: number): number {
  // We're making sine waves here. By Andrew Tuline.
  const allfreq = 16 // Base frequency.
  phaseU[0] = SEGMENT.step
  let phase = phaseF[0] // Phase change value gets calculated (float fits into unsigned long).
  const cutOff = 255 - SEGMENT.intensity // You can change the number of pixels.  AKA INTENSITY (was 192).
  let modVal = 5 //SEGMENT.fft1/8+1;                         // You can change the modulus. AKA FFT1 (was 5).

  let index = Math.floor(strip.now / 64) // Set color rotation speed
  phase = f32(phase + SEGMENT.speed / 32.0) // You can change the speed of the wave. AKA SPEED (was .4)
  phaseF[0] = phase
  SEGMENT.step = phaseU[0]

  for (let i = 0; i < SEGLEN(); i++) {
    if (moder === 1) modVal = inoise8(i * 10 + i * 10) >> 4 // Let's randomize our mod length with some Perlin noise.
    let val = (i + 1) * allfreq // This sets the frequency of the waves. The +1 makes sure that led 0 is used.
    if (modVal === 0) modVal = 1
    val = u32(ftoi(f32(val + f32(f32(phase * ((i % modVal) + 1)) / 2)))) // This sets the varying phase change of the waves. By Andrew Tuline.
    let b = cubicwave8(val) // Now we make an 8 bit sinewave.
    b = b > cutOff ? b - cutOff : 0 // A ternary operator to cutoff the light.
    SEGMENT.setPixelColor(i, color_blend(SEGCOLOR(1), SEGMENT.color_from_palette(index, false, false, 0), b))
    index = u32(index + div(256, SEGLEN()))
    if (SEGLEN() > 256) index = u32(index + 1) // Correction for segments longer than 256 LEDs
  }

  return FRAMETIME
}

export function mode_phased(): number {
  return phased_base(0)
}

export function mode_phased_noise(): number {
  return phased_base(1)
}

// ---- Twinkleup ----------------------------------------------------------------
export function mode_twinkleup(): number {
  // A very short twinkle routine with fade-in and dual controls. By Andrew Tuline.
  const prevSeed = random16_get_seed() // save seed so we can restore it at the end of the function
  random16_set_seed(535) // The randomizer needs to be re-set each time through the loop in order for the same 'random' numbers to be the same each time through.

  for (let i = 0; i < SEGLEN(); i++) {
    const ranstart = random8() // The starting value (aka brightness) for each pixel. Must be consistent each time through the loop for this to work.
    let pixBri = sin8_t(ranstart + Math.floor(mulu(16, strip.now) / (256 - SEGMENT.speed)))
    if (random8() > SEGMENT.intensity) pixBri = 0
    SEGMENT.setPixelColor(i, color_blend(SEGCOLOR(1), SEGMENT.color_from_palette(random8() + Math.floor(strip.now / 100), false, PALETTE_SOLID_WRAP(), 0), pixBri))
  }

  random16_set_seed(prevSeed) // restore original seed so other effects can use "random" PRNG
  return FRAMETIME
}

// ---- Noise Pal ----------------------------------------------------------------
// SEGENV.data holds CRGBPalette16[2]: 16 x {r,g,b} bytes each
const PAL_SIZE = 48
function palLoad(d: Uint8Array, o: number): CRGBPalette16 {
  const p = new CRGBPalette16()
  for (let k = 0; k < 16; k++) p.entries[k] = new CRGB(d[o + 3 * k], d[o + 3 * k + 1], d[o + 3 * k + 2])
  return p
}
function palStore(d: Uint8Array, o: number, p: CRGBPalette16): void {
  for (let k = 0; k < 16; k++) {
    d[o + 3 * k] = p.entries[k].r
    d[o + 3 * k + 1] = p.entries[k].g
    d[o + 3 * k + 2] = p.entries[k].b
  }
}

// Peaceful noise that's slow and with gradually changing palettes. Does not support WLED palettes or default colours or controls.
export function mode_noisepal(): number {
  // Slow noise palette by Andrew Tuline.
  const scale = 15 + (SEGMENT.intensity >> 2) //default was 30

  const dataSize = PAL_SIZE * 2 //allocate space for 2 Palettes (2 * 16 * 3 = 96 bytes)
  if (!SEGMENT.allocateData(dataSize)) return mode_static() //allocation failed

  const d = SEGMENT.data as Uint8Array

  const changePaletteMs = 4000 + SEGMENT.speed * 10 //between 4 - 6.5sec
  if (u32(strip.now - SEGMENT.step) > changePaletteMs) {
    SEGMENT.step = strip.now

    const baseI = random8()
    // sequenced: the argument order is unspecified in C++
    const h1 = random8(64)
    const v1 = random8(128, 255)
    const v2 = random8(128, 255)
    const h3 = random8(92)
    const v3 = random8(128, 255)
    const h4 = random8(92)
    const v4 = random8(128, 255)
    palStore(d, PAL_SIZE, hsvPalette16(new CHSV(baseI + h1, 255, v1), new CHSV(baseI + 128, 255, v2), new CHSV(baseI + h3, 192, v3), new CHSV(baseI + h4, 255, v4)))
  }

  let color = new CRGB()

  //EVERY_N_MILLIS(10) { //(don't have to time this, effect function is only called every 24ms)
  let pal0 = palLoad(d, 0)
  nblendPaletteTowardPalette(pal0, palLoad(d, PAL_SIZE), 48) // Blend towards the target palette over 48 iterations.

  if (SEGMENT.palette > 0) pal0 = SEGPALETTE().clone()
  palStore(d, 0, pal0)

  for (let i = 0; i < SEGLEN(); i++) {
    const index = inoise8(i * scale, SEGMENT.aux0 + i * scale) // Get a value from the noise function. I'm using both x and y axis.
    color = ColorFromPalette(pal0, index, 255, LINEARBLEND) // Use the my own palette.
    SEGMENT.setPixelColor(i, color.red, color.green, color.blue)
  }

  SEGMENT.aux0 = u16(SEGMENT.aux0 + beatsin8_t(10, 1, 4)) // Moving along the distance. Vary it a bit with a sine wave.

  return FRAMETIME
}

// ---- Flow ---------------------------------------------------------------------
export function mode_flow(): number {
  let counter = 0
  if (SEGMENT.speed !== 0) {
    counter = mulu(strip.now, (SEGMENT.speed >> 2) + 1)
    counter = counter >>> 8
  }

  const maxZones = div(SEGLEN(), 6) //only looks good if each zone has at least 6 LEDs
  let zones = (SEGMENT.intensity * maxZones) >>> 8
  if (zones & 0x01) zones++ //zones must be even
  if (zones < 2) zones = 2
  const zoneLen = div(SEGLEN(), zones)
  const offset = u32(SEGLEN() - zones * zoneLen) >>> 1

  SEGMENT.fill(SEGMENT.color_from_palette(u32(-counter), false, true, 255))

  for (let z = 0; z < zones; z++) {
    const pos = offset + z * zoneLen
    for (let i = 0; i < zoneLen; i++) {
      const colorIndex = u32(div(i * 255, zoneLen) - counter)
      const led = z & 0x01 ? i : zoneLen - 1 - i
      // WLED: if (SEGMENT.reverse) led = (zoneLen -1) -led;  -- no segment options here (never reversed)
      SEGMENT.setPixelColor(pos + led, SEGMENT.color_from_palette(colorIndex, false, true, 255))
    }
  }

  return FRAMETIME
}

// ---- Chunchun -----------------------------------------------------------------
export function mode_chunchun(): number {
  if (SEGLEN() === 1) return mode_static()
  SEGMENT.fade_out(254) // add a bit of trail
  let counter = mulu(strip.now, 6 + (SEGMENT.speed >> 4))
  const numBirds = 2 + (SEGLEN() >> 3) // 2 + 1/8 of a segment
  const span = div(SEGMENT.intensity << 8, numBirds)

  for (let i = 0; i < numBirds; i++) {
    counter = u32(counter - span)
    const megumin = u32(sin16_t(counter) + 0x8000)
    let bird = mulu(megumin, SEGLEN()) >>> 16
    const c = SEGMENT.color_from_palette(div(i * 255, numBirds), false, false, 0) // no palette wrapping
    bird = bird > SEGLEN() - 1 ? SEGLEN() - 1 : bird // constrain(bird, 0U, SEGLEN-1U)
    SEGMENT.setPixelColor(bird, c)
  }
  return FRAMETIME
}

// ---- Dancing Shadows ----------------------------------------------------------
// struct Spotlight as the ESP32 lays it out (16 bytes; unsigned long is 4):
// float speed @0, uint8_t colorIdx @4, int16_t position @6,
// unsigned long lastUpdateTime @8, uint8_t width @12, uint8_t type @13
const SPOT_SIZE = 16
const SPOT_TYPE_SOLID = 0
const SPOT_TYPE_GRADIENT = 1
const SPOT_TYPE_2X_GRADIENT = 2
const SPOT_TYPE_2X_DOT = 3
const SPOT_TYPE_3X_DOT = 4
const SPOT_TYPE_4X_DOT = 5
const SPOT_TYPES_COUNT = 6
const SPOT_MAX_COUNT = 49 //Number of simultaneous waves (ESP32)

/*
 * Spotlights moving back and forth that cast dancing shadows.
 * Shine this through tree branches/leaves or other close-up objects that cast
 * interesting shadows onto a ceiling or tarp.
 *
 * By Steve Pomeroy @xxv
 */
export function mode_dancing_shadows(): number {
  if (SEGLEN() === 1) return mode_static()
  const numSpotlights = map(SEGMENT.intensity, 0, 255, 2, SPOT_MAX_COUNT) // 49 on 32 segment ESP32, 17 on 16 segment ESP8266
  const initialize = SEGMENT.aux0 !== numSpotlights
  SEGMENT.aux0 = u16(numSpotlights)

  const dataSize = SPOT_SIZE * numSpotlights
  if (!SEGMENT.allocateData(dataSize)) return mode_static() //allocation failed
  const dv = SEGMENT.dataView as DataView

  SEGMENT.fill(BLACK)

  const time = strip.now
  let respawn = false

  for (let i = 0; i < numSpotlights; i++) {
    const o = i * SPOT_SIZE
    const getSpeed = (): number => dv.getFloat32(o, true)
    const setSpeed = (v: number): void => dv.setFloat32(o, v, true)
    const getPos = (): number => dv.getInt16(o + 6, true)
    const setPos = (v: number): void => dv.setInt16(o + 6, v, true)
    const getWidth = (): number => dv.getUint8(o + 12)
    if (!initialize) {
      // advance the position of the spotlight
      const delta = ftoi(f32(u32(time - dv.getUint32(o + 8, true))) * (getSpeed() * ((1.0 + SEGMENT.speed) / 100.0)))

      if (Math.abs(delta) >= 1) {
        setPos(getPos() + delta)
        dv.setUint32(o + 8, time, true)
      }

      respawn = (getSpeed() > 0.0 && getPos() > SEGLEN() + 2) || (getSpeed() < 0.0 && getPos() < -(getWidth() + 2))
    }

    if (initialize || respawn) {
      dv.setUint8(o + 4, random8())
      dv.setUint8(o + 12, random8(1, 10))

      setSpeed(1.0 / random8(4, 50))

      if (initialize) {
        setPos(random16(SEGLEN()))
        setSpeed(getSpeed() * (random8(2) ? 1.0 : -1.0))
      } else {
        if (random8(2)) {
          setPos(SEGLEN() + getWidth())
          setSpeed(getSpeed() * -1.0)
        } else {
          setPos(-getWidth())
        }
      }

      dv.setUint32(o + 8, time, true)
      dv.setUint8(o + 13, random8(SPOT_TYPES_COUNT))
    }

    const color = SEGMENT.color_from_palette(dv.getUint8(o + 4), false, false, 255)
    const start = getPos()
    const width = getWidth()

    if (width <= 1) {
      if (start >= 0 && start < SEGLEN()) {
        SEGMENT.blendPixelColor(start, color, 128)
      }
    } else {
      switch (dv.getUint8(o + 13)) {
        case SPOT_TYPE_SOLID:
          for (let j = 0; j < width; j++) {
            if (start + j >= 0 && start + j < SEGLEN()) {
              SEGMENT.blendPixelColor(start + j, color, 128)
            }
          }
          break

        case SPOT_TYPE_GRADIENT:
          for (let j = 0; j < width; j++) {
            if (start + j >= 0 && start + j < SEGLEN()) {
              SEGMENT.blendPixelColor(start + j, color, cubicwave8(map(j, 0, width - 1, 0, 255)))
            }
          }
          break

        case SPOT_TYPE_2X_GRADIENT:
          for (let j = 0; j < width; j++) {
            if (start + j >= 0 && start + j < SEGLEN()) {
              SEGMENT.blendPixelColor(start + j, color, cubicwave8(2 * map(j, 0, width - 1, 0, 255)))
            }
          }
          break

        case SPOT_TYPE_2X_DOT:
          for (let j = 0; j < width; j += 2) {
            if (start + j >= 0 && start + j < SEGLEN()) {
              SEGMENT.blendPixelColor(start + j, color, 128)
            }
          }
          break

        case SPOT_TYPE_3X_DOT:
          for (let j = 0; j < width; j += 3) {
            if (start + j >= 0 && start + j < SEGLEN()) {
              SEGMENT.blendPixelColor(start + j, color, 128)
            }
          }
          break

        case SPOT_TYPE_4X_DOT:
          for (let j = 0; j < width; j += 4) {
            if (start + j >= 0 && start + j < SEGLEN()) {
              SEGMENT.blendPixelColor(start + j, color, 128)
            }
          }
          break
      }
    }
  }

  return FRAMETIME
}

// ---- Washing Machine ------------------------------------------------------------
/*
  Imitates a washing machine, rotating same waves forward, then pause, then backward.
  By Stefan Seegel
*/
export function mode_washing_machine(): number {
  const speed = tristate_square8(strip.now >>> 7, 90, 15)

  SEGMENT.step = u32(SEGMENT.step + div(speed * 2048, 512 - SEGMENT.speed))

  for (let i = 0; i < SEGLEN(); i++) {
    const col = sin8_t(div((div(SEGMENT.intensity, 25) + 1) * 255 * i, SEGLEN()) + (SEGMENT.step >>> 7))
    SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(col, false, PALETTE_SOLID_WRAP(), 3))
  }

  return FRAMETIME
}

// ---- Blends ---------------------------------------------------------------------
/*
  Blends random colors across palette
  Modified, originally by Mark Kriegsman https://gist.github.com/kriegsman/1f7ccbbfa492a73c015e
*/
export function mode_blends(): number {
  const pixelLen = SEGLEN() > 255 ? 255 : SEGLEN()
  const dataSize = 4 * (pixelLen + 1) // max segment length of 56 pixels on 16 segment ESP8266
  if (!SEGMENT.allocateData(dataSize)) return mode_static() //allocation failed
  const dv = SEGMENT.dataView as DataView // uint32_t pixels[]
  const blendSpeed = map(SEGMENT.intensity, 0, 255, 10, 128)
  let shift = mulu(strip.now, (SEGMENT.speed >> 3) + 1) >>> 8

  for (let i = 0; i < pixelLen; i++) {
    dv.setUint32(4 * i, color_blend(dv.getUint32(4 * i, true), SEGMENT.color_from_palette(shift + quadwave8((i + 1) * 16), false, PALETTE_SOLID_WRAP(), 255), blendSpeed), true)
    shift = u32(shift + 3)
  }

  let offset = 0
  for (let i = 0; i < SEGLEN(); i++) {
    SEGMENT.setPixelColor(i, dv.getUint32(4 * offset++, true))
    if (offset > pixelLen) offset = 0
  }

  return FRAMETIME
}

// ---- TV Simulator -----------------------------------------------------------------
/*
  TV Simulator
  Modified and adapted to WLED by Def3nder, based on "Fake TV Light for Engineers" by Phillip Burgess https://learn.adafruit.com/fake-tv-light-for-engineers/arduino-sketch
*/
// struct TvSim (48 bytes): uint32 totalTime @0, fadeTime @4, startTime @8, elapsed @12,
// pixelNum @16, uint16 sliderValues @20, uint32 sceeneStart @24, sceeneDuration @28,
// uint16 sceeneColorHue @32, uint8 sceeneColorSat @34, sceeneColorBri @35,
// actualColorR @36, G @37, B @38, uint16 pr @40, pg @42, pb @44
const TV_SIZE = 48
const TV_TOTAL = 0, TV_FADE = 4, TV_START = 8, TV_ELAPSED = 12, TV_SLIDERS = 20, TV_SC_START = 24, TV_SC_DUR = 28
const TV_SC_HUE = 32, TV_SC_SAT = 34, TV_SC_BRI = 35, TV_R = 36, TV_G = 37, TV_B = 38, TV_PR = 40, TV_PG = 42, TV_PB = 44

export function mode_tv_simulator(): number {
  let r: number, g: number, b: number, hue = 0
  let sat = 0, bri = 0, j: number

  if (!SEGMENT.allocateData(TV_SIZE)) return mode_static() //allocation failed
  const tv = SEGMENT.dataView as DataView

  const colorSpeed = u8(map(SEGMENT.speed, 0, 255, 1, 20))
  const colorIntensity = u8(map(SEGMENT.intensity, 0, 255, 10, 30))

  const sliders = (SEGMENT.speed << 8) | SEGMENT.intensity
  if (sliders !== tv.getUint16(TV_SLIDERS, true)) {
    tv.setUint16(TV_SLIDERS, sliders, true)
    SEGMENT.aux1 = 0
  }

  // create a new sceene
  if (u32(strip.now - tv.getUint32(TV_SC_START, true)) >= tv.getUint32(TV_SC_DUR, true) || SEGMENT.aux1 === 0) {
    tv.setUint32(TV_SC_START, strip.now, true) // remember the start of the new sceene
    tv.setUint32(TV_SC_DUR, random16(u16(60 * 250 * colorSpeed), u16(60 * 750 * colorSpeed)), true) // duration of a "movie sceene" which has similar colors (5 to 15 minutes with max speed slider)
    tv.setUint16(TV_SC_HUE, random16(0, 768), true) // random start color-tone for the sceene
    tv.setUint8(TV_SC_SAT, random8(100, u8(130 + colorIntensity))) // random start color-saturation for the sceene
    tv.setUint8(TV_SC_BRI, random8(200, 240)) // random start color-brightness for the sceene
    SEGMENT.aux1 = 1
    SEGMENT.aux0 = 0
  }

  // slightly change the color-tone in this sceene
  if (SEGMENT.aux0 === 0) {
    const sHue = tv.getUint16(TV_SC_HUE, true)
    // hue change in both directions
    j = random8(u8(4 * colorIntensity))
    hue = random8() < 128 ? (j < sHue ? sHue - j : 767 - sHue - j) : j + sHue < 767 ? sHue + j : sHue + j - 767 // negative : positive

    // saturation
    j = random8(u8(2 * colorIntensity))
    sat = u8(tv.getUint8(TV_SC_SAT) - j < 0 ? 0 : tv.getUint8(TV_SC_SAT) - j)

    // brightness
    j = random8(100)
    bri = u8(tv.getUint8(TV_SC_BRI) - j < 0 ? 0 : tv.getUint8(TV_SC_BRI) - j)

    // calculate R,G,B from HSV
    // Source: https://blog.adafruit.com/2012/03/14/constant-brightness-hsb-to-rgb-algorithm/
    {
      // just to create a local scope for  the variables
      const n = (hue >> 8) % 3
      const x = u8((((((hue & 255) * sat) >> 8) * bri) >> 8))
      const s = u8(((256 - sat) * bri) >> 8)
      const temp = [s, u8(x + s), u8(bri - x), s, u8(x + s)]
      tv.setUint8(TV_R, temp[n + 2])
      tv.setUint8(TV_G, temp[n + 1])
      tv.setUint8(TV_B, temp[n])
    }
  }
  // Apply gamma correction, further expand to 16/16/16
  const nr = gamma8(tv.getUint8(TV_R)) * 257 // New R/G/B
  const ng = gamma8(tv.getUint8(TV_G)) * 257
  const nb = gamma8(tv.getUint8(TV_B)) * 257

  if (SEGMENT.aux0 === 0) {
    // initialize next iteration
    SEGMENT.aux0 = 1

    // randomize total duration and fade duration for the actual color
    tv.setUint32(TV_TOTAL, random16(250, 2500), true) // Semi-random pixel-to-pixel time
    tv.setUint32(TV_FADE, random16(0, u16(tv.getUint32(TV_TOTAL, true))), true) // Pixel-to-pixel transition time
    if (random8(10) < 3) tv.setUint32(TV_FADE, 0, true) // Force scene cut 30% of time

    tv.setUint32(TV_START, strip.now, true)
  } // end of initialization

  // how much time is elapsed ?
  tv.setUint32(TV_ELAPSED, u32(strip.now - tv.getUint32(TV_START, true)), true)
  const elapsed = tv.getUint32(TV_ELAPSED, true)
  const fadeTime = tv.getUint32(TV_FADE, true)

  // fade from prev color to next color
  if (elapsed < fadeTime) {
    r = map(elapsed, 0, fadeTime, tv.getUint16(TV_PR, true), nr)
    g = map(elapsed, 0, fadeTime, tv.getUint16(TV_PG, true), ng)
    b = map(elapsed, 0, fadeTime, tv.getUint16(TV_PB, true), nb)
  } else {
    // Avoid divide-by-zero in map()
    r = nr
    g = ng
    b = nb
  }

  // set strip color
  for (let i = 0; i < SEGLEN(); i++) {
    SEGMENT.setPixelColor(i, r >> 8, g >> 8, b >> 8) // Quantize to 8-bit
  }

  // if total duration has passed, remember last color and restart the loop
  if (elapsed >= tv.getUint32(TV_TOTAL, true)) {
    tv.setUint16(TV_PR, nr, true) // Prev RGB = new RGB
    tv.setUint16(TV_PG, ng, true)
    tv.setUint16(TV_PB, nb, true)
    SEGMENT.aux0 = 0
  }

  return FRAMETIME
}

// ---- Perlin Move ----------------------------------------------------------------
// 16 bit perlinmove. Use Perlin Noise instead of sinewaves for movement. By Andrew Tuline.
// Controls are speed, # of pixels, faderate.
export function mode_perlinmove(): number {
  if (SEGLEN() === 1) return mode_static()
  SEGMENT.fade_out(255 - SEGMENT.custom1)
  for (let i = 0; i < div(SEGMENT.intensity, 16) + 1; i++) {
    const t = Math.floor(mulu(strip.now, 128) / (260 - SEGMENT.speed))
    const locn = inoise16(u32(t + i * 15000), t) // Get a new pixel location from moving noise.
    const pixloc = u32(map(locn, 50 * 256, 192 * 256, 0, SEGLEN() - 1)) // Map that to the length of the strand, and ensure we don't go over.
    SEGMENT.setPixelColor(pixloc, SEGMENT.color_from_palette(pixloc % 255, false, PALETTE_SOLID_WRAP(), 0))
  }

  return FRAMETIME
} // mode_perlinmove()

// ---- Wavesins -------------------------------------------------------------------
// Uses beatsin8() + phase shifting. By: Andrew Tuline
export function mode_wavesins(): number {
  for (let i = 0; i < SEGLEN(); i++) {
    const bri = sin8_t(u32(Math.floor(strip.now / 4) + i * SEGMENT.intensity))
    const index = beatsin8_t(SEGMENT.speed, SEGMENT.custom1, u8(SEGMENT.custom1 + SEGMENT.custom2), 0, u8(i * (SEGMENT.custom3 << 3))) // custom3 is reduced resolution slider
    //SEGMENT.setPixelColor(i, ColorFromPalette(SEGPALETTE, index, bri, LINEARBLEND));
    SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(index, false, PALETTE_SOLID_WRAP(), 0, bri))
  }

  return FRAMETIME
} // mode_waveins()

// ---- Flow Stripe ----------------------------------------------------------------
// By: ldirko  https://editor.soulmatelights.com/gallery/392-flow-led-stripe , modifed by: Andrew Tuline
export function mode_FlowStripe(): number {
  if (SEGLEN() === 1) return mode_static()
  const hl = div(SEGLEN() * 10, 13)
  const hue = u8(Math.floor(strip.now / (SEGMENT.speed + 1)))
  const t = Math.floor(strip.now / (div(SEGMENT.intensity, 8) + 1))

  for (let i = 0; i < SEGLEN(); i++) {
    let c = div(Math.abs(i - hl), hl) * 127
    c = sin8_t(c)
    c = sin8_t(u32(div(c, 2) + t))
    const b = sin8_t(u32(c + Math.floor(t / 8)))
    SEGMENT.setPixelColor(i, new CRGB(new CHSV(b + hue, 255, 255)))
  }

  return FRAMETIME
} // mode_FlowStripe()
