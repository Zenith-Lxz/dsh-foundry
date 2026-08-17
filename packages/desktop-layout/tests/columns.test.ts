import { describe, expect, it } from 'vitest'
import {
  CENTER_MIN,
  DETAILS_DEFAULT,
  DETAILS_MAX,
  DETAILS_MIN,
  SIDEBAR_COLLAPSED,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  TRAFFIC_LIGHT_SAFE_WIDTH,
  clampWidth,
  computeColumns,
} from '../src/client/columns.ts'

describe('clampWidth', () => {
  it.each([
    [100, SIDEBAR_MIN],
    [999, SIDEBAR_MAX],
    [300, 300],
  ])('clamps %d into the sidebar range', (input, expected) => {
    expect(clampWidth(input, SIDEBAR_MIN, SIDEBAR_MAX)).toBe(expected)
  })

  it('rounds fractional drag positions to whole pixels', () => {
    expect(clampWidth(300.6, SIDEBAR_MIN, SIDEBAR_MAX)).toBe(301)
  })
})

describe('computeColumns', () => {
  it('gives every column its preference when the frame is wide enough', () => {
    const columns = computeColumns(1600, SIDEBAR_DEFAULT, DETAILS_DEFAULT)
    expect(columns.sidebar).toBe(SIDEBAR_DEFAULT)
    expect(columns.details).toBe(DETAILS_DEFAULT)
    expect(columns.center).toBe(1600 - SIDEBAR_DEFAULT - DETAILS_DEFAULT)
    expect(columns.center).toBeGreaterThanOrEqual(CENTER_MIN)
  })

  it('renders a closed sidebar as the fixed control rail, not as zero width', () => {
    expect(computeColumns(1600, 0, 0).sidebar).toBe(SIDEBAR_COLLAPSED)
  })

  it('shrinks details before the center drops below its floor', () => {
    // 280 sidebar + 640 center leaves 380 for details, inside its range.
    const columns = computeColumns(1300, SIDEBAR_DEFAULT, DETAILS_MAX)
    expect(columns.center).toBe(CENTER_MIN)
    expect(columns.details).toBeLessThan(DETAILS_MAX)
    expect(columns.details).toBeGreaterThanOrEqual(DETAILS_MIN)
  })

  it('auto-closes details rather than shrinking it below its floor', () => {
    const columns = computeColumns(1000, SIDEBAR_DEFAULT, DETAILS_DEFAULT)
    expect(columns.details).toBe(0)
    expect(columns.sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('never concedes the sidebar; the center absorbs the final deficit', () => {
    const columns = computeColumns(600, SIDEBAR_DEFAULT, DETAILS_DEFAULT)
    expect(columns.sidebar).toBe(SIDEBAR_DEFAULT)
    expect(columns.details).toBe(0)
    expect(columns.center).toBe(600 - SIDEBAR_DEFAULT)
  })

  it('never produces a negative center', () => {
    expect(computeColumns(100, SIDEBAR_DEFAULT, DETAILS_DEFAULT).center).toBe(0)
  })

  it('is pure, so re-widening restores the previous layout exactly', () => {
    const wide = computeColumns(1600, SIDEBAR_DEFAULT, DETAILS_DEFAULT)
    computeColumns(700, SIDEBAR_DEFAULT, DETAILS_DEFAULT)
    // The auto-close above is derived, never written back, which is what makes
    // this recovery automatic rather than a stored restore step.
    expect(computeColumns(1600, SIDEBAR_DEFAULT, DETAILS_DEFAULT)).toEqual(wide)
  })

  it('re-clamps stale preferences arriving from the store', () => {
    const columns = computeColumns(2000, 5000, 5000)
    expect(columns.sidebar).toBe(SIDEBAR_MAX)
    expect(columns.details).toBe(DETAILS_MAX)
  })

  it('keeps the columns summing to the viewport whenever the center has room', () => {
    for (const viewport of [1024, 1280, 1440, 1600, 1920, 2560]) {
      const columns = computeColumns(viewport, SIDEBAR_DEFAULT, DETAILS_DEFAULT)
      expect(columns.sidebar + columns.center + columns.details).toBe(viewport)
    }
  })
})

describe('macOS traffic-light safe area', () => {
  it('reserves enough width for the three controls at their inset origin', () => {
    // The window insets the controls at x=18; three 12px lights on 20px pitch
    // end at 18 + 2*20 + 12 = 70, so the reserved area must exceed that.
    expect(TRAFFIC_LIGHT_SAFE_WIDTH).toBeGreaterThan(70)
  })

  it('leaves the sidebar usable at its narrowest once the safe area is reserved', () => {
    // The safe area lives in the title bar, so it never eats column width —
    // the narrowest sidebar still exceeds it, which is what keeps the rail and
    // the controls from colliding at the minimum window size.
    expect(SIDEBAR_MIN).toBeGreaterThan(TRAFFIC_LIGHT_SAFE_WIDTH)
  })
})
