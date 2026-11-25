import { model, mark, units } from "./portfolio.js";
export function payoff(positions, b, spot, date, base = "cost", ivShift = 0) {
  return positions.reduce((sum, p) => {
    const value = model(
      p,
      b,
      spot,
      date,
      Math.max(0, (p.iv ?? 0) + ivShift),
    ).price;
    return (
      sum +
      (value - (base === "cost" ? p.entry : mark(p, b))) * units(p) -
      (base === "cost" ? p.commission : 0)
    );
  }, 0);
}
export function expiryStats(positions, b) {
  const dates = new Set(
    positions.filter((p) => p.type !== "stock").map((p) => p.expiration),
  );
  if (dates.size > 1 || new Set(positions.map((p) => p.symbol)).size > 1)
    return null;
  const date = [...dates][0] ?? b.asOf;
  const strikes = [
    ...new Set([
      0,
      ...positions.filter((p) => p.type !== "stock").map((p) => p.strike),
    ]),
  ].sort((a, b) => a - b);
  const f = (x) => payoff(positions, b, x, date),
    values = strikes.map(f);
  const slope = positions
    .filter((p) => p.type !== "put")
    .reduce((a, p) => a + units(p), 0);
  const roots = [];
  strikes.forEach((x, i) => {
    const v = values[i];
    if (v === 0) roots.push(x);
    if (i && v * values[i - 1] < 0)
      roots.push(x - (v * (x - strikes[i - 1])) / (v - values[i - 1]));
  });
  if (slope && values.at(-1) * slope < 0)
    roots.push(strikes.at(-1) - values.at(-1) / slope);
  return {
    maxProfit: slope > 0 ? Infinity : Math.max(0, ...values),
    maxLoss: slope < 0 ? Infinity : Math.max(0, ...values.map((v) => -v)),
    roots,
  };
}
