/**
 * Adjusting a picked element by hand on the page (VisBug, UiToolbar): drag
 * its right or bottom edge to resize it, and nudge its margin or padding a
 * side at a time with the arrow keys.
 *
 * The page shows each step live; what comes back is the result as style
 * edits — `width`, `height`, `margin`, `padding` in pixels, only for what the
 * person touched — so it joins the pick's other edits and is sent the same
 * way, as a before → after request for the agent to make in the source.
 */

/** Top, right, bottom, left, as CSS orders them. */
export type Sides = [number, number, number, number]

export interface AdjustState {
  width: number
  height: number
  margin: Sides
  padding: Sides
}

export type AdjustSpacing = "margin" | "padding"
export type ResizeZone = "x" | "y" | "xy"

/** How near an edge, in CSS pixels, a press still grabs it. */
export const EDGE_SLOP = 6
export const BIG_STEP = 10

/** Which edge of `rect` a press at (x, y) grabs: right, bottom, or the corner. */
export function resizeZone(
  rect: { left: number; top: number; right: number; bottom: number },
  x: number,
  y: number,
  slop = EDGE_SLOP
): ResizeZone | null {
  const inX = x >= rect.left - slop && x <= rect.right + slop
  const inY = y >= rect.top - slop && y <= rect.bottom + slop
  const right = inY && Math.abs(x - rect.right) <= slop
  const bottom = inX && Math.abs(y - rect.bottom) <= slop
  if (right && bottom) return "xy"
  if (right) return "x"
  if (bottom) return "y"
  return null
}

const SIDE_OF_KEY: Record<string, number> = {
  ArrowUp: 0,
  ArrowRight: 1,
  ArrowDown: 2,
  ArrowLeft: 3,
}

export function isNudgeKey(key: string): boolean {
  return key in SIDE_OF_KEY
}

/**
 * One arrow key: the side it points at grows by a pixel (ten with Shift), or
 * shrinks with Alt — never below zero.
 */
export function nudge(
  state: AdjustState,
  key: string,
  { spacing, shrink, big }: { spacing: AdjustSpacing; shrink: boolean; big: boolean }
): AdjustState {
  const side = SIDE_OF_KEY[key]
  if (side === undefined) return state
  const sides = [...state[spacing]] as Sides
  const step = (big ? BIG_STEP : 1) * (shrink ? -1 : 1)
  sides[side] = Math.max(0, Math.round(sides[side]! + step))
  return { ...state, [spacing]: sides }
}

/** The new size after dragging from where the press started; at least a pixel. */
export function resize(
  start: AdjustState,
  zone: ResizeZone,
  dx: number,
  dy: number
): Pick<AdjustState, "width" | "height"> {
  return {
    width: zone === "y" ? start.width : Math.max(1, Math.round(start.width + dx)),
    height: zone === "x" ? start.height : Math.max(1, Math.round(start.height + dy)),
  }
}

function pixels(value: number): string {
  return `${Math.round(value * 100) / 100}px`
}

/** `8px 16px`, as short as CSS lets four sides be written. */
export function sidesShorthand([top, right, bottom, left]: Sides): string {
  if (top === right && right === bottom && bottom === left) return pixels(top)
  if (top === bottom && right === left) return `${pixels(top)} ${pixels(right)}`
  if (right === left) return `${pixels(top)} ${pixels(right)} ${pixels(bottom)}`
  return [top, right, bottom, left].map(pixels).join(" ")
}

const same = (a: Sides, b: Sides) => a.every((value, index) => value === b[index])

/** Style edits for what changed between the start and now. */
export function adjustChanges(start: AdjustState, now: AdjustState): Record<string, string> {
  const changes: Record<string, string> = {}
  if (now.width !== start.width) changes.width = pixels(now.width)
  if (now.height !== start.height) changes.height = pixels(now.height)
  if (!same(now.margin, start.margin)) changes.margin = sidesShorthand(now.margin)
  if (!same(now.padding, start.padding)) changes.padding = sidesShorthand(now.padding)
  return changes
}

/** What the hint bar says while adjusting: the size, and the spacing being nudged. */
export function adjustStatus(
  state: AdjustState,
  spacing: AdjustSpacing,
  labels: Record<AdjustSpacing, string>
): string {
  const sides = state[spacing].map((value) => Math.round(value)).join(" ")
  return `${Math.round(state.width)}×${Math.round(state.height)}  ·  ${labels[spacing]} ${sides}`
}
