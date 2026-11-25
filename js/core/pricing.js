const SQRT_2PI = Math.sqrt(2 * Math.PI);
function normalPDF(x) {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}
function normalCDF(x) {
  if (Number.isNaN(x)) return NaN;
  if (x === 0) return 0.5;
  const y = Math.abs(x);
  if (y > 37) return x > 0 ? 1 : 0;
  const e = Math.exp(-0.5 * y * y);
  let tail;
  if (y < 7.0710678118654755) {
    const n =
      (((((0.0352624965998911 * y + 0.700383064443688) * y + 6.37396220353165) *
        y +
        33.912866078383) *
        y +
        112.079291497871) *
        y +
        221.213596169931) *
        y +
      220.206867912376;
    const d =
      ((((((0.0883883476483184 * y + 1.75566716318264) * y + 16.064177579207) *
        y +
        86.7807322029461) *
        y +
        296.564248779674) *
        y +
        637.333633378831) *
        y +
        793.826512519948) *
        y +
      440.413735824752;
    tail = (e * n) / d;
  } else {
    tail = e / (y + 1 / (y + 2 / (y + 3 / (y + 4 / (y + 0.65))))) / SQRT_2PI;
  }
  return x > 0 ? 1 - tail : tail;
}
// T in YEARS, sigma/r/q in decimals. Greeks per option share;
// theta per calendar day, vega per one percentage point of IV.
// European exercise, continuous compounding, constant volatility.
export function blackScholes(type, S, K, T, sigma, r = 0.04, q = 0) {
  if (
    !["put", "call"].includes(type) ||
    ![S, K, T, sigma, r, q].every(Number.isFinite) ||
    S < 0 ||
    K <= 0 ||
    T < 0 ||
    sigma < 0
  )
    throw new RangeError("Invalid Black–Scholes inputs");
  const call = type === "call";
  if (T === 0) {
    const callDelta = S > K ? 1 : S < K ? 0 : 0.5;
    return {
      price: Math.max(call ? S - K : K - S, 0),
      delta: call ? callDelta : callDelta - 1,
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
    };
  }
  const dq = Math.exp(-q * T),
    dr = Math.exp(-r * T);
  if (S === 0)
    return {
      price: call ? 0 : K * dr,
      delta: call ? 0 : -dq,
      gamma: 0,
      theta: call ? 0 : (r * K * dr) / 365,
      vega: 0,
      rho: call ? 0 : (-K * T * dr) / 100,
    };
  if (sigma === 0) {
    const forwardDiff = S * dq - K * dr,
      active = call ? forwardDiff > 0 : forwardDiff < 0;
    if (
      Math.abs(forwardDiff) <=
      Number.EPSILON * Math.max(S * dq, K * dr) * 2
    ) {
      const direction = call ? 1 : -1;
      return {
        price: 0,
        delta: (direction * dq) / 2,
        gamma: 0,
        theta: (direction * (q * S * dq - r * K * dr)) / 730,
        rho: (direction * K * T * dr) / 200,
        vega: (S * dq * normalPDF(0) * Math.sqrt(T)) / 100,
      };
    }
    return {
      price: Math.max(call ? forwardDiff : -forwardDiff, 0),
      delta: active ? (call ? dq : -dq) : 0,
      gamma: 0,
      theta: active
        ? (call ? q * S * dq - r * K * dr : r * K * dr - q * S * dq) / 365
        : 0,
      vega: 0,
      rho: active ? ((call ? 1 : -1) * K * T * dr) / 100 : 0,
    };
  }
  const rootT = Math.sqrt(T),
    d1 =
      (Math.log(S / K) + (r - q + (sigma * sigma) / 2) * T) / (sigma * rootT),
    d2 = d1 - sigma * rootT;
  const pdf = normalPDF(d1),
    base = (-S * dq * pdf * sigma) / (2 * rootT);
  return {
    price: Math.max(
      0,
      call
        ? S * dq * normalCDF(d1) - K * dr * normalCDF(d2)
        : K * dr * normalCDF(-d2) - S * dq * normalCDF(-d1),
    ),
    delta: call ? dq * normalCDF(d1) : -dq * normalCDF(-d1),
    gamma: (dq * pdf) / (S * sigma * rootT),
    theta:
      (call
        ? base - r * K * dr * normalCDF(d2) + q * S * dq * normalCDF(d1)
        : base + r * K * dr * normalCDF(-d2) - q * S * dq * normalCDF(-d1)) /
      365,
    rho: ((call ? normalCDF(d2) : -normalCDF(-d2)) * K * T * dr) / 100,
    vega: (S * dq * pdf * rootT) / 100,
  };
}

export function impliedVolatility(
  type,
  spot,
  strike,
  years,
  market,
  rate = 0.04,
  dividend = 0,
) {
  if (years <= 0 || spot <= 0 || !Number.isFinite(market)) return null;
  const price = (iv) =>
    blackScholes(type, spot, strike, years, iv, rate, dividend).price;
  if (
    market < price(0) ||
    market >=
      (type === "call"
        ? spot * Math.exp(-dividend * years)
        : strike * Math.exp(-rate * years))
  )
    return null;
  if (market === price(0)) return 0;
  let lo = 0,
    hi = 1;
  while (price(hi) < market && hi < 1024) hi *= 2;
  if (price(hi) < market) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (price(mid) < market) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
