/** Sum an array of prices in dollars. */
export function total(prices) {
  let sum = 0
  for (const price of prices) sum += price
  return sum
}
