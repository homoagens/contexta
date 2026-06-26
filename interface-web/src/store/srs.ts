/**
 * Spaced-repetition scheduling — an SM-2 derived algorithm.
 *
 * A favorite word is a flashcard. After each review the user rates recall,
 * and the next due date is pushed out (or reset) accordingly.
 */
import type { SrsState } from '../types'

export type Rating = 'again' | 'hard' | 'good' | 'easy'

const DAY = 86_400_000          // ms in a day
const MIN_EASE = 1.3
const MAX_EASE = 3.0
const INITIAL_EASE = 2.5

/** A brand-new card: due immediately. */
export function freshCard(): SrsState {
  return { due: 0, interval: 0, ease: INITIAL_EASE, reps: 0, lapses: 0 }
}

function clampEase(e: number): number {
  return Math.max(MIN_EASE, Math.min(MAX_EASE, e))
}

/** Compute the next SRS state from a review rating. */
export function schedule(prev: SrsState | undefined, rating: Rating): SrsState {
  const s = prev ?? freshCard()
  const now = Date.now()
  let { interval, ease, reps, lapses } = s

  switch (rating) {
    case 'again':
      reps = 0
      lapses += 1
      ease = clampEase(ease - 0.2)
      interval = 0
      // due again in ~10 minutes
      return { due: now + 10 * 60_000, interval, ease, reps, lapses }

    case 'hard':
      ease = clampEase(ease - 0.15)
      interval = Math.max(1, Math.round((interval || 1) * 1.2))
      reps += 1
      break

    case 'good':
      if (reps === 0)      interval = 1
      else if (reps === 1) interval = 3
      else                 interval = Math.round(interval * ease)
      reps += 1
      break

    case 'easy':
      ease = clampEase(ease + 0.15)
      interval = Math.round((interval || 1) * ease * 1.3)
      reps += 1
      break
  }

  return { due: now + interval * DAY, interval, ease, reps, lapses }
}

/** True if the card should be reviewed now (new cards are always due). */
export function isDue(s: SrsState | undefined, now: number = Date.now()): boolean {
  return !s || s.due <= now
}

/** Human-readable preview of when each rating would push the card to. */
export function intervalPreview(prev: SrsState | undefined, rating: Rating): string {
  const next = schedule(prev, rating)
  if (rating === 'again') return '10 min'
  if (next.interval < 1) return '<1 g'
  if (next.interval === 1) return '1 g'
  if (next.interval < 30) return `${next.interval} g`
  return `${Math.round(next.interval / 30)} mesi`
}
