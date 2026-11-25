import { cash } from "./components.js";
let chart;
export const colors = ["#58dca9", "#78a8eb", "#edba74", "#ae93e6", "#f78193"];
export function clearChart() {
  chart?.destroy();
  chart = null;
}
export function chartBox(series) {
  return (
    '<div class="legend">' +
    series
      .map(
        ([label], i) =>
          '<span style="--swatch:' + colors[i % 5] + '">' + label + "</span>",
      )
      .join("") +
    '</div><div class="chartbox"><canvas id="plot" aria-label="标的价格与组合盈亏曲线" role="img"></canvas></div>'
  );
}
export function draw(series, xs, spot) {
  clearChart();
  const canvas = document.querySelector("#plot");
  if (!canvas) return;
  const style = getComputedStyle(document.body),
    line = style.getPropertyValue("--line"),
    muted = style.getPropertyValue("--muted");
  const marker = {
    id: "spot",
    afterDraw(c) {
      const {
          ctx,
          scales: { x },
          chartArea: { top, bottom },
        } = c,
        px = x.getPixelForValue(spot);
      ctx.save();
      ctx.strokeStyle = muted;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px, bottom);
      ctx.stroke();
      ctx.fillStyle = muted;
      ctx.textAlign = "center";
      ctx.font = "11px monospace";
      ctx.fillText("S $" + spot, px, top - 5);
      ctx.restore();
    },
  };
  chart = new Chart(canvas, {
    type: "line",
    plugins: [marker],
    data: {
      datasets: series.map(([label, f], i) => ({
        label,
        data: xs.map((x) => ({ x, y: f(x) })),
        borderColor: colors[i % 5],
        borderWidth: i === 0 ? 2.8 : 1.7,
        borderDash: i === 1 ? [6, 5] : [],
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: i === 0 ? "origin" : false,
        backgroundColor: "#5bdca910",
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      layout: { padding: { top: 18 } },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => "Underlying " + cash(items[0].parsed.x),
            label: (item) => item.dataset.label + "  " + cash(item.parsed.y),
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          min: xs[0],
          max: xs.at(-1),
          grid: { color: line },
          ticks: {
            color: muted,
            maxTicksLimit: 8,
            callback: (v) => "$" + Number(v.toFixed(1)),
          },
          title: {
            display: true,
            text: "Underlying price (USD)",
            color: muted,
          },
        },
        y: {
          grid: { color: (ctx) => (ctx.tick.value === 0 ? muted : line) },
          ticks: {
            color: muted,
            maxTicksLimit: 6,
            callback: (v) => (Math.abs(v) >= 1000 ? v / 1000 + "k" : v),
          },
          title: { display: true, text: "P&L (USD)", color: muted },
        },
      },
    },
  });
}
