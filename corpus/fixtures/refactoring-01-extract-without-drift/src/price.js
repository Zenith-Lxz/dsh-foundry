/** Compute an order total. */
export function total(items, memberYears) {
  let sum = 0
  for (const item of items) sum += item.price * item.quantity
  const rate = memberYears >= 5 ? 0.15 : memberYears >= 1 ? 0.05 : 0
  const discounted = Math.round(sum * (1 - rate) * 100) / 100
  return Math.round(discounted * 1.08 * 100) / 100
}
