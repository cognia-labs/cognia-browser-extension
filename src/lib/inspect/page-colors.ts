/**
 * Colour as the page computes it, for contrast checks and palettes.
 *
 * `getComputedStyle` answers in whatever space the page wrote — `rgb()` for
 * most, `oklch()` or `color(display-p3 …)` for a modern design system — so
 * colours are read through a 1×1 canvas, which resolves any CSS colour to
 * sRGB bytes. Where there is no canvas (jsdom), `rgb()` and hex are parsed by
 * hand and anything else is unknown.
 */

/** sRGB channels 0–255 and alpha 0–1. */
export type Rgba = [number, number, number, number]

const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/i

/** `rgb()`, `rgba()` and hex, without a canvas. */
export function parseColor(value: string): Rgba | null {
  const css = value.trim().toLowerCase()
  if (css === "transparent") return [0, 0, 0, 0]
  const rgb = css.match(RGB)
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1)
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Math.max(0, Math.min(1, alpha))]
  }
  const hex = css.match(/^#([0-9a-f]{3,8})$/)?.[1]
  if (!hex || ![3, 4, 6, 8].includes(hex.length)) return null
  const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join("") : hex
  const channel = (at: number) => Number.parseInt(full.slice(at, at + 2), 16)
  return [channel(0), channel(2), channel(4), full.length === 8 ? channel(6) / 255 : 1]
}

/** A reader for one document, caching each colour it has resolved. */
export function createColorReader(): (css: string) => Rgba | null {
  const cache = new Map<string, Rgba | null>()
  let context: OffscreenCanvasRenderingContext2D | null | undefined
  return (css) => {
    if (cache.has(css)) return cache.get(css) ?? null
    let answer = parseColor(css)
    if (!answer) {
      if (context === undefined) {
        context =
          typeof OffscreenCanvas === "function"
            ? new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true })
            : null
      }
      if (context) {
        // A colour the canvas cannot parse leaves the sentinel standing.
        context.fillStyle = "#010203"
        context.fillStyle = css
        if (context.fillStyle !== "#010203") {
          context.clearRect(0, 0, 1, 1)
          context.fillRect(0, 0, 1, 1)
          const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
          answer = [r ?? 0, g ?? 0, b ?? 0, (a ?? 0) / 255]
        }
      }
    }
    cache.set(css, answer)
    return answer
  }
}

/** `top` drawn over `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const alpha = top[3] + bottom[3] * (1 - top[3])
  if (alpha === 0) return [0, 0, 0, 0]
  const mix = (index: 0 | 1 | 2) =>
    (top[index] * top[3] + bottom[index] * bottom[3] * (1 - top[3])) / alpha
  return [mix(0), mix(1), mix(2), alpha]
}

/** WCAG 2 relative luminance. */
export function luminance([r, g, b]: Rgba): number {
  const linear = (channel: number) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** WCAG 2 contrast ratio, 1–21, of two opaque colours. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

/** `#rrggbb`, or `#rrggbbaa` for a translucent colour. */
export function toHex([r, g, b, a]: Rgba): string {
  const two = (value: number) =>
    Math.round(Math.max(0, Math.min(255, value)))
      .toString(16)
      .padStart(2, "0")
  return `#${two(r)}${two(g)}${two(b)}${a < 1 ? two(a * 255) : ""}`
}

/** `rgb(37 99 235)`, or with `/ alpha`. */
export function toRgbString([r, g, b, a]: Rgba): string {
  const round = (value: number) => Math.round(value)
  return `rgb(${round(r)} ${round(g)} ${round(b)}${a < 1 ? ` / ${Number(a.toFixed(2))}` : ""})`
}

/** Hue 0–360, saturation and lightness 0–1. */
export function toHsl([r, g, b]: Rgba): [number, number, number] {
  const [red, green, blue] = [r / 255, g / 255, b / 255]
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const light = (max + min) / 2
  let hue = 0
  let saturation = 0
  if (max !== min) {
    const delta = max - min
    saturation = light > 0.5 ? delta / (2 - max - min) : delta / (max + min)
    hue =
      max === red
        ? (green - blue) / delta + (green < blue ? 6 : 0)
        : max === green
          ? (blue - red) / delta + 2
          : (red - green) / delta + 4
    hue *= 60
  }
  return [hue, saturation, light]
}

/** An opaque sRGB colour from hue 0–360, saturation and lightness 0–1. */
export function fromHsl(hue: number, saturation: number, light: number): Rgba {
  const chroma = (1 - Math.abs(2 * light - 1)) * saturation
  const sector = (((hue % 360) + 360) % 360) / 60
  const second = chroma * (1 - Math.abs((sector % 2) - 1))
  const [r, g, b] =
    sector < 1
      ? [chroma, second, 0]
      : sector < 2
        ? [second, chroma, 0]
        : sector < 3
          ? [0, chroma, second]
          : sector < 4
            ? [0, second, chroma]
            : sector < 5
              ? [second, 0, chroma]
              : [chroma, 0, second]
  const match = light - chroma / 2
  return [(r + match) * 255, (g + match) * 255, (b + match) * 255, 1]
}

/** `hsl(221 83% 53%)`, or with `/ alpha`. */
export function toHslString(rgba: Rgba): string {
  const [hue, saturation, light] = toHsl(rgba)
  return `hsl(${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(light * 100)}%${
    rgba[3] < 1 ? ` / ${Number(rgba[3].toFixed(2))}` : ""
  })`
}

/**
 * The colour nearest `foreground` that reaches `target` contrast on
 * `background` (Stark, the contrast checkers): the same hue and saturation,
 * the lightness moved the least it must — towards dark on a light
 * background, towards light on a dark one, the other way if that cannot get
 * there. `null` when neither can.
 */
export function suggestContrast(foreground: Rgba, background: Rgba, target: number): Rgba | null {
  const [hue, saturation, light] = toHsl(foreground)
  const darkFirst = luminance(background) > 0.18
  for (const direction of darkFirst ? [-1, 1] : [1, -1]) {
    for (let step = 1; step <= 200; step++) {
      const next = light + direction * step * 0.005
      if (next < 0 || next > 1) break
      const candidate = fromHsl(hue, saturation, next).map((channel, index) =>
        index < 3 ? Math.round(channel) : channel
      ) as Rgba
      if (contrastRatio(candidate, background) >= target) return candidate
    }
  }
  return null
}
