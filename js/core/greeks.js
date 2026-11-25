import { model, units } from "./portfolio.js";
export const names = ["delta", "gamma", "theta", "vega", "rho"];
export function aggregate(positions, b) {
  const result = Object.fromEntries(names.map((k) => [k, 0]));
  for (const p of positions) {
    const g = model(p, b);
    for (const k of names)
      result[k] +=
        (p.type !== "stock" && p.expiration > b.asOf
          ? (p.greeks?.[k] ?? g[k])
          : g[k]) * units(p);
  }
  return result;
}
