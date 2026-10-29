import { apiCall } from "../aliexpress.js";
const q = (keywords, extra = {}) => apiCall("aliexpress.affiliate.product.query", { keywords, tracking_id: process.env.ALI_TRACKING_ID, ship_to_country: "IL", target_currency: "ILS", target_language: "HE", page_size: "50", ...extra }).then((r) => r.products?.product ?? r.products ?? []).catch((e) => (console.log("ERR", e.message), []));
const CASES = [
  ["microwave oven", "6", /מיקרוגל|microwave/i, 150],
  ["Baseus solar camera", "30", /baseus/i, 0],
  ["Ruckus R350 access point", "7", /r350/i, 0],
  ["Melitta water filter", "6", /melitta|מליטה/i, 0],
  ["car tablet holder", "34", /טאבלט|tablet|ipad/i, 0],
  ["IPL hair removal", "66", /ipl|הסרת שיער|hair removal/i, 0],
  ["robot vacuum", "6", /שואב|vacuum/i, 300],
  ["gaming headset microphone", "44", /אוזניות|headset/i, 0],
];
for (const [kw, cat, good, minPrice] of CASES) {
  for (const [label, extra] of [["vol", { sort: "LAST_VOLUME_DESC" }], ["rel", {}], ["vol+cat", { sort: "LAST_VOLUME_DESC", category_ids: cat }], ["rel+cat", { category_ids: cat }]]) {
    const ps = await q(kw, extra);
    const hits = ps.filter((p) => good.test(p.product_title) && Number(p.target_sale_price) >= minPrice);
    const sold = hits.reduce((s, p) => s + Number(p.lastest_volume || 0), 0);
    console.log(`${kw.padEnd(28)} cat=${cat.padEnd(9)} ${label.padEnd(8)} results ${String(ps.length).padStart(2)}  real-item ${String(hits.length).padStart(2)}  sold ${sold}  top: ${hits.slice(0, 2).map((p) => `${p.lastest_volume}|₪${p.target_sale_price}|${p.product_title.slice(0, 35)}`).join(" ; ")}`);
  }
}
