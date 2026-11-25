export const cash = (n) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      })
    : "Unlimited";
export const number = (n) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "—";
export const tone = (n) => (n < 0 ? "neg" : n > 0 ? "pos" : "");
export const percent = (n) => (n == null ? "—" : number(n * 100) + "%");
export const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  Dashboard:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  Portfolio:
    '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 13h18"/>',
  "Payoff Analyzer": '<path d="M3 3v17h18M5 16l5-7 5 3 6-8"/>',
  "Roll Analyzer": '<path d="M3 8h16l-4-4m6 12H5l4 4"/>',
  "Antifragility Lab":
    '<path d="M9 3h6m-5 0v7L4 19q-1 2 2 2h12q3 0 2-2l-6-9V3M7 15h10"/>',
  "Insurance Manager":
    '<path d="M12 2l8 4v6q0 5-8 10-8-5-8-10V6zM8 12l3 3 5-6"/>',
  "Risk Monitor": '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  "Trade Journal":
    '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M9 7h7m-7 5h7m-7 5h4"/>',
  Settings:
    '<path d="M3 6h5m5 0h8M3 17h10m5 0h3"/><circle cx="10" cy="6" r="2.5"/><circle cx="15" cy="17" r="2.5"/>',
  cash: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/>',
};
export const pages = Object.keys(paths).slice(0, 9);
export const icon = (name) =>
  '<svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  paths[name] +
  "</svg>";
export const panel = (title, content, tool = "") =>
  '<section class="panel"><div class="panelhead"><h2>' +
  title +
  "</h2>" +
  tool +
  "</div>" +
  content +
  "</section>";
export const card = (title, value, sub, ico, cls = "") =>
  '<div class="card"><div class="cardtop">' +
  title +
  icon(ico) +
  '</div><div class="metric ' +
  cls +
  '">' +
  value +
  "</div><small>" +
  sub +
  "</small></div>";
export const line = (label, value) =>
  '<div class="listrow"><span>' +
  label +
  '</span><b class="num">' +
  value +
  "</b></div>";
export const table = (cols, rows) =>
  '<div class="scroll"><table><thead><tr>' +
  cols.map((h) => "<th>" + h + "</th>").join("") +
  "</tr></thead><tbody>" +
  rows
    .map(
      (row) => "<tr>" + row.map((c) => "<td>" + c + "</td>").join("") + "</tr>",
    )
    .join("") +
  "</tbody></table></div>";
export function field(label, key, value, type = "number", attrs = "") {
  return (
    "<label>" +
    label +
    '<input name="' +
    key +
    '" type="' +
    type +
    '" value="' +
    esc(value ?? "") +
    '" ' +
    (type === "number" ? 'step="any" ' : "") +
    attrs +
    "></label>"
  );
}
export const select = (label, key, items, active) =>
  "<label>" +
  label +
  '<select name="' +
  key +
  '">' +
  items
    .map(
      ([val, txt]) =>
        '<option value="' +
        esc(val) +
        '" ' +
        (String(val) === String(active) ? "selected" : "") +
        ">" +
        esc(txt) +
        "</option>",
    )
    .join("") +
  "</select></label>";
export const legName = (p) =>
  p.type === "stock"
    ? "Stock"
    : (p.quantity > 0 ? "Long " : "Short ") +
      (p.type === "put" ? "Put" : "Call") +
      " · $" +
      number(p.strike);
