import { model, mark, units, pnl } from "../core/portfolio.js";
import { aggregate } from "../core/greeks.js";
export function roll(p, newLeg, b) {
  const close = mark(p, b) * units(p),
    open = -newLeg.entry * units(newLeg);
  const oldGreeks = aggregate([p], b),
    nextGreeks = aggregate([newLeg], b);
  return {
    close,
    open,
    net: close + open,
    realized: pnl(p, b),
    changes: Object.fromEntries(
      Object.keys(oldGreeks).map((k) => [k, nextGreeks[k] - oldGreeks[k]]),
    ),
  };
}
