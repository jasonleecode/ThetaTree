import { units } from "../core/portfolio.js";
export function wheel(legs) {
  const sum = (f) => legs.filter(f).reduce((s, p) => s + units(p), 0);
  return {
    shares: sum((p) => p.type === "stock"),
    putShares: sum((p) => p.type === "put" && p.quantity > 0),
    callShares: Math.abs(sum((p) => p.type === "call" && p.quantity < 0)),
  };
}
