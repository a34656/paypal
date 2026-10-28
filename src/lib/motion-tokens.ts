/**
 * Shared motion presets. Springs are spread straight into `animate()` / `transition`, so their shape
 * matches motion's spring options. Durations are seconds; easings are cubic-bezier tuples.
 */
export const motionTokens = {
  spring: {
    /** Shape changes: an action stretching across a row. */
    morph: { type: "spring", stiffness: 520, damping: 44, mass: 1 },
    /** Calm travel home and height collapse. */
    smooth: { type: "spring", stiffness: 340, damping: 38, mass: 1 },
    /** Quick snap to an open stop. */
    snappy: { type: "spring", stiffness: 620, damping: 42, mass: 0.9 },
  },
  duration: {
    instant: 0.12,
    standard: 0.24,
  },
  ease: {
    /** Matches the `--ease-cine` CSS token. */
    enter: [0.22, 1, 0.36, 1],
  },
} as const;
