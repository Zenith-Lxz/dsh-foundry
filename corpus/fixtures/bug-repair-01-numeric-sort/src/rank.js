/** Rank scores from highest to lowest. */
export function rank(scores) {
  return [...scores].sort().reverse()
}
