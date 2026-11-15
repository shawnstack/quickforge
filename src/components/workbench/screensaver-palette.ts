/**
 * 屏保配色：从主色派生同族深底与两个邻色，让氛围场的渐变跨越真实不同的色相，
 * 而不是把同一个颜色调亮调暗。暖色数码管白与冷灰文字是固定中性色，不随主色漂移。
 */

export type ScreensaverPalette = {
  accent: string
  companion: string
  counter: string
  void: string
  deep: string
  haze: string
  numeral: string
  muted: string
}

function hexToHsl(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16) / 255
  const g = Number.parseInt(value.slice(2, 4), 16) / 255
  const b = Number.parseInt(value.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const light = (max + min) / 2
  const delta = max - min
  if (delta === 0) return [0, 0, light * 100]
  const sat = delta / (1 - Math.abs(2 * light - 1))
  let hue: number
  if (max === r) hue = ((g - b) / delta) % 6
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4
  return [(hue * 60 + 360) % 360, sat * 100, light * 100]
}

function hslToHex(hue: number, sat: number, light: number): string {
  const h = ((hue % 360) + 360) % 360
  const s = Math.min(100, Math.max(0, sat)) / 100
  const l = Math.min(100, Math.max(0, light)) / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x]
  const channel = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

export function deriveScreensaverPalette(accent: string): ScreensaverPalette {
  const normalized = /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#3aa981'
  const [hue, sat] = hexToHsl(normalized)
  return {
    accent: normalized.toLowerCase(),
    companion: hslToHex(hue + 44, Math.min(92, sat + 8), 62),
    counter: hslToHex(hue - 78, Math.min(90, sat + 4), 60),
    void: hslToHex(hue, 34, 4),
    deep: hslToHex(hue + 16, 30, 8),
    haze: hslToHex(hue, 26, 15),
    numeral: '#e7e2d4',
    muted: hslToHex(hue, 12, 64),
  }
}