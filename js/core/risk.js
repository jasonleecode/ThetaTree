import { units, model } from "./portfolio.js";
export function risk(positions, b) {
  let assignment = 0,
    protectedShares = 0,
    shares = 0,
    uncovered = 0;
  for (const symbol of new Set(positions.map((p) => p.symbol))) {
    const legs = positions.filter((p) => p.symbol === symbol);
    const count = (f) => legs.filter(f).reduce((s, p) => s + units(p), 0);
    const stock = Math.max(
      0,
      count((p) => p.type === "stock"),
    );
    shares += stock;
    protectedShares += Math.min(
      stock,
      count((p) => p.type === "put" && p.quantity > 0),
    );
    uncovered += Math.max(
      0,
      -count((p) => p.type === "call" && p.quantity < 0) - stock,
    );
    for (const p of legs)
      if (p.type === "put" && p.quantity < 0) assignment -= p.strike * units(p);
  }
  return {
    assignment,
    reserve: b.cash - assignment,
    coverage: shares ? protectedShares / shares : null,
    uncovered,
  };
}

// A uniform percentage shock reprices each symbol independently.
export function shockedExposure(b, move) {
  return b.positions.reduce((total, p) => {
    const s = b.quotes[p.symbol];
    return (
      total +
      (model(p, b, s * (1 + move)).price - model(p, b, s).price) * units(p)
    );
  }, 0);
}
