/** Apply the membership discount. */
export function discount(sum, memberYears) {
  const rate = memberYears >= 5 ? 0.15 : memberYears >= 1 ? 0.05 : 0
  return Math.round(sum * (1 - rate) * 100) / 100
}

/** Apply sales tax. */
export function tax(amount) {
  return Math.round(amount * 1.08 * 100) / 100
}

/** Compute an order total. */
export function total(items, memberYears) {
  let sum = 0
  for (const item of items) sum += item.price * item.quantity
  return tax(discount(sum, memberYears))
}
