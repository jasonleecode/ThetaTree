import { payoff } from "../core/payoff.js";
export const shocks = [-0.9, -0.7, -0.5, -0.3, -0.2, -0.1, 0.1, 0.2, 0.5, 1];
export function stress(
  legs,
  b,
  symbol,
  date,
  base,
  ivShift = 0,
  spot = b.quotes[symbol],
) {
  return shocks.map((move) => ({
    move,
    pnl: payoff(legs, b, spot * (1 + move), date, base, ivShift),
  }));
}
export function tail(legs, b, symbol, date, ivShift = 0, s = b.quotes[symbol]) {
  const f = (x) => payoff(legs, b, s * x, date, "cost", ivShift);
  const slope = (f(0.1) - f(0.01)) / (s * 0.09);
  const centralSlope = (f(1.1) - f(0.9)) / (s * 0.2);
  let label = "Hedged";
  if (!legs.some((p) => p.quantity !== 0)) label = "No exposure";
  else if (slope > 1e-6) label = "Fragile";
  else if (slope < -1e-6)
    label = centralSlope > slope + 1e-6 ? "Tail Convex" : "Directional short";
  return { slope, centralSlope, label };
}
export function leveragedPath(returns, fee = 0) {
  const path = [1];
  for (const r of returns)
    path.push(path.at(-1) * Math.max(0, 1 + 3 * r - fee / 252));
  return path;
}
