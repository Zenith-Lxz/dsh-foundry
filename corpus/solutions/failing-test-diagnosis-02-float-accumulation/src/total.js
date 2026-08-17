/** Sum an array of prices in dollars. */
export function total(prices) {
  let cents = 0
  for (const price of prices) cents += Math.round(price * 100)
  return cents / 100
}
