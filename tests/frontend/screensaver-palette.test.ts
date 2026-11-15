import { describe, expect, it } from 'vitest'
import { deriveScreensaverPalette } from '../../src/components/workbench/screensaver-palette'
import { SCREENSAVER_ACCENTS } from '../../src/lib/workbench-screensaver-settings'

function hueOf(hex: string): number {
  const value = hex.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16) / 255
  const g = Number.parseInt(value.slice(2, 4), 16) / 255
  const b = Number.parseInt(value.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta === 0) return 0
  const hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return (hue * 60 + 360) % 360
}

function lightnessOf(hex: string): number {
  const value = hex.replace('#', '')
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255)
  return (Math.max(...channels) + Math.min(...channels)) / 2
}

function hueGap(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360
  return Math.min(diff, 360 - diff)
}

describe('屏保调色板', () => {
  it('每个主色都派生出合法 hex，且底色够暗、文字够亮', () => {
    for (const accent of SCREENSAVER_ACCENTS) {
      const palette = deriveScreensaverPalette(accent)
      for (const color of Object.values(palette)) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/)
      }
      expect(lightnessOf(palette.void)).toBeLessThan(0.08)
      expect(lightnessOf(palette.deep)).toBeLessThan(0.14)
      expect(lightnessOf(palette.numeral)).toBeGreaterThan(0.8)
      expect(lightnessOf(palette.muted)).toBeGreaterThan(0.5)
      expect(palette.accent).toBe(accent)
    }
  })

  it('渐变跨越真实不同色相：邻色与主色至少差 30 度，两个邻色彼此也分开', () => {
    for (const accent of SCREENSAVER_ACCENTS) {
      const palette = deriveScreensaverPalette(accent)
      const base = hueOf(accent)
      expect(hueGap(hueOf(palette.companion), base)).toBeGreaterThan(30)
      expect(hueGap(hueOf(palette.counter), base)).toBeGreaterThan(30)
      expect(hueGap(hueOf(palette.companion), hueOf(palette.counter))).toBeGreaterThan(60)
    }
  })

  it('六个主色两两可分辨，暖色数码管白不随主色漂移', () => {
    const hues = SCREENSAVER_ACCENTS.map((accent) => hueOf(accent))
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        expect(hueGap(hues[i], hues[j])).toBeGreaterThan(20)
      }
    }
    const first = deriveScreensaverPalette(SCREENSAVER_ACCENTS[0])
    const last = deriveScreensaverPalette(SCREENSAVER_ACCENTS[SCREENSAVER_ACCENTS.length - 1])
    expect(first.numeral).toBe(last.numeral)
    expect(first.void).not.toBe(last.void)
  })

  it('非法主色回退到苔绿而不是产出 NaN 颜色', () => {
    expect(deriveScreensaverPalette('not-a-color')).toEqual(deriveScreensaverPalette('#3aa981'))
    expect(deriveScreensaverPalette('')).toEqual(deriveScreensaverPalette('#3aa981'))
  })
})