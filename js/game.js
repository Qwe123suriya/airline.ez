/* airline.ez — a simple airline game.
   One hub (Bangkok). Open a route = pick a city + a plane. Every day each route earns
   tickets − fuel − plane upkeep. Earn enough and new regions of the world open up. */
"use strict";

/* ---------------- data ---------------- */
const HUB = "BKK";
const DAY_MS = 6000;                 // one game day = 6 s at 1×
const START_CASH = 250e6;
const OPEN_FEE = 2e6;                // one-off fee to open a route
const SELL_BACK = .7;                // planes sell for 70% of their price

// seats, range (km), speed (km/h), fuel cost per km (฿), price (฿)
const PLANES = [
  {id: "s", n: "เครื่องบินใบพัด", ex: "ATR 72", ico: "🛩️", seats: 70, range: 1600, speed: 500, cpk: 28, price: 60e6, tip: "ถูก เหมาะกับเมืองใกล้ คนไม่เยอะ"},
  {id: "m", n: "ลำตัวแคบ", ex: "A320", ico: "✈️", seats: 180, range: 6300, speed: 830, cpk: 95, price: 150e6, tip: "ตัวหลักของสายการบิน บินได้เกือบทั้งเอเชีย"},
  {id: "l", n: "ลำตัวกว้าง", ex: "B787", ico: "🛫", seats: 290, range: 13500, speed: 900, cpk: 120, price: 520e6, tip: "บินไกลข้ามทวีป ประหยัดต่อที่นั่ง"},
  {id: "x", n: "จัมโบ้สองชั้น", ex: "A380", ico: "🐋", seats: 500, range: 15000, speed: 900, cpk: 190, price: 1200e6, tip: "จุคนมากที่สุด สำหรับเมืองใหญ่มาก"}
];
const plane = id => PLANES.find(p => p.id === id);

// regions open with your level
const REGIONS = [
  {id: "th", n: "ไทย", lv: 1}, {id: "sea", n: "อาเซียน", lv: 1}, {id: "ea", n: "เอเชียตะวันออก", lv: 2},
  {id: "sa", n: "เอเชียใต้และตะวันออกกลาง", lv: 3}, {id: "oc", n: "โอเชียเนีย", lv: 4},
  {id: "eu", n: "ยุโรป", lv: 5}, {id: "am", n: "อเมริกา", lv: 6}
];
// level by total profit earned
const LEVELS = [
  [0, "สายการบินน้องใหม่"], [40e6, "สายการบินท้องถิ่น"], [150e6, "สายการบินภูมิภาค"], [500e6, "สายการบินระดับประเทศ"],
  [1.5e9, "สายการบินระดับทวีป"], [4e9, "สายการบินนานาชาติ"], [10e9, "สายการบินระดับโลก"], [25e9, "ตำนานแห่งท้องฟ้า"]
];
const city = c => CITIES.find(x => x.c === c);
const regionOf = c => REGIONS.find(r => r.id === city(c).reg);

/* ---------------- helpers ---------------- */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
function money(v, short) {
  const s = v < 0 ? "−" : "", a = Math.abs(v);
  if (short || a >= 1e6) {
    if (a >= 1e9) return s + "฿" + (a / 1e9).toFixed(a >= 1e10 ? 1 : 2) + " พันล้าน";
    if (a >= 1e6) return s + "฿" + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + " ล้าน";
    if (a >= 1e3) return s + "฿" + Math.round(a / 1e3) + "K";
  }
  return s + "฿" + Math.round(a).toLocaleString();
}
function dist(a, b) {
  const R = 6371, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
const fare = km => Math.round((400 + 2.4 * km) / 10) * 10;            // ticket price
const demandOf = (to, km) => {                                          // travellers per day (both ways)
  const a = city(HUB), b = city(to), f = km < 300 ? .5 : 1 / (1 + (km / 9000) ** 2);
  return Math.round(30 * Math.sqrt(a.w * b.w) * f * eventMult(to));
};
const maxTrips = (p, km) => Math.max(1, Math.floor(18 / (km / p.speed + .8)));   // flights a day one plane can fly

/* ---------------- state ---------------- */
const KEY = "airline-ez-v1";
let S = null;
function load() { try { const t = localStorage.getItem(KEY); return t ? JSON.parse(t) : null } catch (e) { return null } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)) } catch (e) {} }
function newGame(name) {
  S = {v: 1, name: name || "สายการบินของฉัน", cash: START_CASH, day: 1, routes: [], nid: 1, earned: 0, hist: [], lv: 1, ev: null, tut: 0, speed: 1, news: []};
  save();
}
const level = () => { let l = 1; LEVELS.forEach((x, i) => { if (S.earned >= x[0]) l = i + 1 }); return l };
const regionOpen = id => REGIONS.find(r => r.id === id).lv <= level();
const cityOpen = c => regionOpen(city(c).reg);
const eventMult = c => S && S.ev && S.ev.city === c && S.ev.until >= S.day ? 1.5 : 1;

/* ---------------- economy ---------------- */
// What a route does in one day with the planes it has. Planes only fly as many trips as needed (about 85% full).
function calc(to, planes) {
  const km = dist(city(HUB), city(to)), dem = demandOf(to, km), price = fare(km);
  let cap = 0;
  const ps = planes.map(plane);
  for (const p of ps) cap += maxTrips(p, km) * p.seats;
  const use = cap ? Math.min(1, dem / (.85 * cap)) : 0;
  let seats = 0, fuel = 0, trips = 0, upkeep = 0;
  for (const p of ps) {
    const t = Math.max(1, Math.round(maxTrips(p, km) * use));
    trips += t; seats += t * p.seats; fuel += t * km * p.cpk; upkeep += p.price * .001;
  }
  const pax = Math.min(dem, seats), rev = pax * price, cost = fuel + upkeep;
  return {km, dem, price, cap, seats, trips, pax, lf: seats ? pax / seats : 0, rev, fuel, upkeep, cost, profit: rev - cost, short: dem - seats >= Math.max(10, dem * .05) ? dem - seats : 0};
}
const routeCalc = r => calc(r.to, r.planes);
// the best plane to add to a route (or to start it with): most extra profit per baht, that you can afford
function bestPlane(to, planes, cashOnly) {
  const km = dist(city(HUB), city(to)), base = calc(to, planes).profit;
  let best = null;
  for (const p of PLANES) {
    if (p.range < km) continue;
    const g = calc(to, [...planes, p.id]).profit - base, pay = g > 0 ? Math.ceil(p.price / g) : Infinity;
    const o = {p, gain: g, pay, ok: S.cash >= p.price + (planes.length ? 0 : OPEN_FEE)};
    if (cashOnly && !o.ok) continue;
    if (g > 0 && (!best || pay < best.pay)) best = o;
  }
  return best;
}

/* ---------------- day tick ---------------- */
let dayT = 0, last = performance.now(), floaters = [];
function endDay() {
  let total = 0;
  for (const r of S.routes) {
    const c = routeCalc(r);
    r.h = [...(r.h || []), Math.round(c.profit)].slice(-14);
    r.last = {pax: c.pax, profit: c.profit};
    total += c.profit;
  }
  // float the day's earnings above the 6 best routes on the map (more would just pile up)
  floaters = S.routes.map(r => ({to: r.to, v: r.last.profit, t: performance.now()})).sort((a, b) => b.v - a.v).slice(0, 6);
  S.cash += total; S.earned += Math.max(0, total);
  S.hist = [...S.hist, Math.round(total)].slice(-30);
  S.day++;
  // a small event now and then: a festival doubles the fun at one city for 5 days
  if ((!S.ev || S.ev.until < S.day) && Math.random() < .08) {
    const open = CITIES.filter(c => c.c !== HUB && cityOpen(c.c));
    const c = open[Math.floor(Math.random() * open.length)];
    S.ev = {city: c.c, until: S.day + 4};
    news(`🎉 เทศกาลที่${c.n} คนอยากบินไปเพิ่ม 50% อีก 5 วัน`);
  }
  const l = level();
  if (l > S.lv) {
    S.lv = l;
    const reg = REGIONS.filter(r => r.lv === l).map(r => r.n);
    celebrate(`ขึ้นเป็น Lv ${l} · ${LEVELS[l - 1][1]}`, reg.length ? `🔓 เปิดภูมิภาคใหม่: ${reg.join(", ")}` : "");
    news(`⭐ Lv ${l} ${LEVELS[l - 1][1]}${reg.length ? " · เปิด " + reg.join(", ") : ""}`);
  }
  save();
  if (tab !== "map") render(); else updateTop();
}
function news(t) { S.news = [{d: S.day, t}, ...(S.news || [])].slice(0, 12) }

/* ---------------- actions ---------------- */
function openRoute(to, pid) {
  const p = plane(pid), cost = p.price + OPEN_FEE;
  if (S.cash < cost || S.routes.some(r => r.to === to)) return false;
  S.cash -= cost;
  S.routes.push({id: S.nid++, to, planes: [pid], h: [], since: S.day});
  news(`🛫 เปิดเส้นทางใหม่ ${HUB} → ${to} (${city(to).n}) ด้วย${p.n}`);
  save(); toast(`เปิดเส้นทางไป${city(to).n}แล้ว! เงินจะเข้าทุกสิ้นวัน`); return true;
}
function addPlane(r, pid) {
  const p = plane(pid);
  if (S.cash < p.price) return false;
  S.cash -= p.price; r.planes.push(pid); save(); toast(`เพิ่ม${p.n}ในเส้นทาง${city(r.to).n}แล้ว`); return true;
}
function sellPlane(r, i) {
  const p = plane(r.planes[i]); S.cash += p.price * SELL_BACK; r.planes.splice(i, 1);
  if (!r.planes.length) { S.routes = S.routes.filter(x => x !== r); toast(`ขาย${p.n}และปิดเส้นทาง${city(r.to).n}แล้ว`) }
  else toast(`ขาย${p.n}ได้ ${money(p.price * SELL_BACK)}`);
  save();
}

/* ---------------- UI shell ---------------- */
let tab = "map";
const PLANE_SVG = '<svg viewBox="0 0 24 24"><path fill="#fff" d="M21 15.5v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V8.5l-8 5v2l8-2.5V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5z"/></svg>';
function render() {
  if (!S) return renderStart();
  $("#app").innerHTML = `
  <header class="top"><div class="wrap">
    <div class="logo">${PLANE_SVG}</div>
    <div class="brand"><b>${esc(S.name)}</b><small id="dayl"></small></div>
    <div class="cash"><b class="num" id="cash"></b><small id="pday" class="num"></small></div>
  </div><div class="wrap speed">${[[0, "⏸ หยุด"], [1, "1×"], [2, "2×"], [4, "4×"]].map(([v, n]) => `<button data-sp="${v}" class="${S.speed === v ? "on" : ""}">${n}</button>`).join("")}</div>
  <div class="daybar"><i id="daybar"></i></div></header>
  <main><div class="wrap stack" id="view"></div></main>
  <nav class="tabs"><div class="wrap">${[["map", "🗺️", "แผนที่"], ["routes", "✈️", "เส้นทาง"], ["goals", "🏆", "เป้าหมาย"]].map(([k, i, n]) => `<button data-tab="${k}" class="${tab === k ? "on" : ""}"><span>${i}</span>${n}</button>`).join("")}</div></nav>`;
  $$("[data-sp]").forEach(b => b.onclick = () => { S.speed = +b.dataset.sp; save(); $$("[data-sp]").forEach(x => x.classList.toggle("on", x === b)) });
  $$("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); scrollTo(0, 0) });
  const v = $("#view");
  v.innerHTML = tab === "map" ? mapHTML() : tab === "routes" ? routesHTML() : goalsHTML();
  bindView(); updateTop();
  if (tab === "map") initMap();
  if (S.tut < 3) coach();
}
function updateTop() {
  if (!$("#cash")) return;
  $("#cash").textContent = money(S.cash, true);
  const p = S.routes.reduce((a, r) => a + routeCalc(r).profit, 0);
  $("#pday").innerHTML = `<span class="${p >= 0 ? "good" : "bad"}">${p >= 0 ? "+" : ""}${money(p, true)}/วัน</span>`;
  $("#dayl").textContent = `วันที่ ${S.day} · Lv ${level()} ${LEVELS[level() - 1][1]}`;
}

/* map tab */
function mapHTML() {
  const tot = S.routes.reduce((a, r) => { const c = routeCalc(r); a.p += c.profit; a.x += c.pax; return a }, {p: 0, x: 0});
  return `<div class="mapbox"><canvas id="map" aria-label="แผนที่ แตะเมืองเพื่อเปิดเส้นทาง"></canvas>
    <div class="mapctl"><button data-z="in" aria-label="ซูมเข้า">+</button><button data-z="out" aria-label="ซูมออก">−</button><button data-z="home" aria-label="กลับไปที่ฐาน">⌂</button></div>
    <div class="maphint">แตะเมืองบนแผนที่เพื่อเปิดเส้นทาง</div></div>
  <div class="kpis"><div class="kpi"><small>เส้นทาง</small><b class="num">${S.routes.length}</b></div><div class="kpi"><small>ผู้โดยสาร/วัน</small><b class="num">${tot.x.toLocaleString()}</b></div><div class="kpi"><small>กำไร/วัน</small><b class="num ${tot.p >= 0 ? "good" : "bad"}">${money(tot.p, true)}</b></div></div>
  <button class="btn primary big" data-new>+ เปิดเส้นทางใหม่</button>
  ${S.news && S.news.length ? `<div class="card"><h3 style="font-size:16px;margin-bottom:6px">ข่าว</h3>${S.news.slice(0, 4).map(n => `<div class="small"><span class="muted">วันที่ ${n.d}</span> · ${esc(n.t)}</div>`).join("")}</div>` : ""}`;
}

/* routes tab */
function routesHTML() {
  if (!S.routes.length) return `<div class="card empty"><div class="big">🛫</div><h2>ยังไม่มีเส้นทาง</h2><p class="muted">เลือกเมือง เลือกเครื่องบิน แล้วเงินจะเข้าทุกสิ้นวัน</p><button class="btn primary big" data-new>+ เปิดเส้นทางแรก</button></div>`;
  return `<div class="row between"><h2>เส้นทางของคุณ</h2><button class="btn primary" data-new>+ เปิดใหม่</button></div>
  ${S.routes.map(r => {
    const c = routeCalc(r), to = city(r.to), full = c.short > 0;
    return `<button class="route" data-route="${r.id}">
      <div><div class="to">${HUB} → ${r.to} · ${esc(to.n)}</div><div class="small muted">${c.km.toLocaleString()} กม. · ตั๋ว ${money(c.price)} · <span class="planes">${r.planes.map(id => plane(id).ico).join("")}</span></div></div>
      <div class="pf num ${c.profit >= 0 ? "good" : "bad"}">${c.profit >= 0 ? "+" : ""}${money(c.profit, true)}<div class="small muted" style="font-family:var(--f-body)">ต่อวัน</div></div>
      <div style="grid-column:1/-1"><div class="bar ${full ? "full" : ""}"><i style="width:${Math.round(Math.min(1, c.dem / Math.max(1, c.seats)) * 100)}%"></i></div>
      <div class="row between small" style="margin-top:4px"><span>👥 ${c.pax.toLocaleString()} / ${c.dem.toLocaleString()} คนอยากบิน</span>${full ? `<span class="tag">ที่นั่งไม่พอ +เครื่อง</span>` : `<span class="muted">ที่นั่งเต็ม ${Math.round(c.lf * 100)}%</span>`}</div></div>
    </button>`}).join("")}`;
}

/* goals tab */
function goalsHTML() {
  const l = level(), next = LEVELS[l], cur = LEVELS[l - 1], pc = next ? clamp((S.earned - cur[0]) / (next[0] - cur[0]), 0, 1) : 1;
  const h = S.hist.slice(-14), mx = Math.max(1, ...h.map(Math.abs));
  return `<div class="card"><div class="lv"><div class="lvbadge">${l}</div><div style="flex:1"><h2>${LEVELS[l - 1][1]}</h2>
    <div class="small muted">กำไรสะสม ${money(S.earned, true)}${next ? ` · อีก ${money(next[0] - S.earned, true)} ถึง Lv ${l + 1}` : " · ระดับสูงสุดแล้ว"}</div></div></div>
    <div class="bar" style="margin-top:10px"><i style="width:${pc * 100}%;background:var(--accent)"></i></div></div>
  <div class="card"><h3 style="font-size:16px;margin-bottom:8px">ภูมิภาค</h3><div class="steps">${REGIONS.map(r => `<div class="step ${regionOpen(r.id) ? "done" : r.lv === l + 1 ? "now" : ""}"><i>${regionOpen(r.id) ? "✓" : r.lv}</i><span>${r.n}${regionOpen(r.id) ? "" : ` <span class="muted small">· เปิดที่ Lv ${r.lv}</span>`}</span></div>`).join("")}</div></div>
  <div class="card"><h3 style="font-size:16px;margin-bottom:8px">กำไร 14 วันล่าสุด</h3>${h.length ? `<div style="display:flex;align-items:flex-end;gap:4px;height:90px">${h.map(v => `<div title="${money(v)}" style="flex:1;height:${Math.max(4, Math.abs(v) / mx * 90)}px;border-radius:5px;background:${v >= 0 ? "var(--good)" : "var(--bad)"}"></div>`).join("")}</div>` : `<div class="muted small">ยังไม่มีข้อมูล รอจบวันแรกก่อน</div>`}</div>
  <div class="card"><h3 style="font-size:16px;margin-bottom:6px">วิธีเล่น</h3><div class="small">
    1. กด <b>+ เปิดเส้นทางใหม่</b> เลือกเมือง เกมจะบอกว่ามีคนอยากบินกี่คนและแนะนำเครื่องบินให้<br>
    2. ทุกสิ้นวันเงินจะเข้า = ค่าตั๋ว − น้ำมัน − ค่าดูแลเครื่อง<br>
    3. ถ้าเส้นไหนขึ้นว่า <span class="tag">ที่นั่งไม่พอ</span> ให้เพิ่มเครื่องบิน<br>
    4. กำไรสะสมถึงเป้า จะขึ้นเลเวลและเปิดภูมิภาคใหม่ บินได้ไกลขึ้น</div>
    <button class="btn" style="margin-top:10px" data-reset>เริ่มเกมใหม่</button></div>`;
}

function bindView() {
  $$("[data-new]").forEach(b => b.onclick = () => openSheet(newRouteSheet({})));
  $$("[data-route]").forEach(b => b.onclick = () => openSheet(routeSheet(+b.dataset.route)));
  const rs = $("[data-reset]"); if (rs) rs.onclick = () => { if (confirm("เริ่มเกมใหม่? ความคืบหน้าทั้งหมดจะหายไป")) { localStorage.removeItem(KEY); S = null; render() } };
  $$("[data-z]").forEach(b => b.onclick = () => { const k = b.dataset.z; if (k === "home") camTo(fitCam()); else cam.span = clamp(cam.span * (k === "in" ? .7 : 1.4), 8, 360) });
}

/* ---------------- sheets ---------------- */
let sheetFn = null;
function openSheet(fn) { sheetFn = fn; drawSheet() }
function closeSheet() { sheetFn = null; $("#sheet").innerHTML = ""; render() }
function drawSheet() {
  if (!sheetFn) return; const keep = $(".sheet") ? $(".sheet").scrollTop : 0;
  $("#sheet").innerHTML = `<div class="scrim" id="scrim"><div class="sheet" role="dialog">${sheetFn()}</div></div>`;
  $(".sheet").scrollTop = keep;
  $("#scrim").onclick = e => { if (e.target.id === "scrim") closeSheet() };
  $$("[data-x]").forEach(b => b.onclick = closeSheet);
  sheetFn.bind && sheetFn.bind();
}
const head = (t, sub) => `<div class="sheet-head"><div style="flex:1"><h2>${t}</h2>${sub ? `<div class="small muted">${sub}</div>` : ""}</div><button class="x" data-x aria-label="ปิด">✕</button></div>`;

// New route: pick a city (sorted by expected profit), then a plane, then open
function newRouteSheet(st) {
  const fn = () => {
    st.sort = st.sort || "profit";
    const hub = city(HUB), have = new Set(S.routes.map(r => r.to));
    const list = CITIES.filter(c => c.c !== HUB && !have.has(c.c)).map(c => {
      const km = dist(hub, c), open = cityOpen(c.c), b = open ? bestPlane(c.c, [], false) : null;
      return {c, km, open, b, dem: demandOf(c.c, km), reach: PLANES.some(p => p.range >= km)};
    }).sort((a, b) => (b.open - a.open) || (st.sort === "near" ? a.km - b.km : st.sort === "people" ? b.dem - a.dem : (b.b ? b.b.gain : -1e12) - (a.b ? a.b.gain : -1e12)));
    let out = head("เปิดเส้นทางใหม่", `ออกจาก${hub.n} · ค่าเปิดเส้นทาง ${money(OPEN_FEE)}`);
    out += `<div class="seg" style="margin-bottom:10px">${[["profit", "💰 กำไรดีสุด"], ["people", "👥 คนเยอะสุด"], ["near", "📍 ใกล้สุด"]].map(([k, n]) => `<button data-sort="${k}" class="${st.sort === k ? "on" : ""}">${n}</button>`).join("")}</div><div class="pick">`;
    for (const {c, km, open, b, dem} of list) {
      if (!open) { out += `<div class="dest lock"><span class="code">${c.c}</span><span><b>${esc(c.n)}</b><br><span class="small muted">🔒 เปิดที่ Lv ${regionOf(c.c).lv} (${regionOf(c.c).n})</span></span><span></span></div>`; continue }
      out += `<button class="dest ${st.to === c.c ? "sel" : ""}" data-to="${c.c}"><span class="code">${c.c}</span>
        <span><b>${esc(c.n)}</b>${eventMult(c.c) > 1 ? ' <span class="tag">🎉 เทศกาล</span>' : ""}<br><span class="small muted">${km.toLocaleString()} กม. · 👥 ${dem.toLocaleString()} คน/วัน</span></span>
        <span class="pf num ${b ? "good" : "muted"}">${b ? "+" + money(b.gain, true) : "—"}<br><span class="small muted" style="font-family:var(--f-body);font-weight:400">${b ? "ต่อวัน" : "ไกลเกินไป"}</span></span></button>`;
    }
    out += `</div>`;
    if (st.to) {
      const to = city(st.to), km = dist(hub, to), rec = bestPlane(st.to, [], true) || bestPlane(st.to, [], false);
      st.p = st.p && plane(st.p).range >= km ? st.p : rec ? rec.p.id : null;
      out += `<div class="sticky"><div class="card stack" style="gap:10px"><div class="row between"><h3 style="font-size:17px">${HUB} → ${st.to} · ${esc(to.n)}</h3><span class="muted small num">${km.toLocaleString()} กม.</span></div>
        <div class="explain">มีคนอยากบิน <b>${demandOf(st.to, km).toLocaleString()} คน/วัน</b> · ตั๋วใบละ ${money(fare(km))} · เลือกเครื่องบิน:</div><div class="pick">`;
      for (const p of PLANES) {
        const ok = p.range >= km, c = ok ? calc(st.to, [p.id]) : null, pay = c && c.profit > 0 ? Math.ceil(p.price / c.profit) : null;
        out += `<button class="model ${st.p === p.id ? "sel" : ""}" data-p="${p.id}" ${ok ? "" : "disabled"}><span class="ico">${p.ico}</span>
          <span><b>${p.n}</b>${rec && rec.p.id === p.id ? '<span class="best">แนะนำ</span>' : ""}<br><span class="small muted">${ok ? `${p.seats} ที่นั่ง · ${money(p.price, true)}` : `บินได้แค่ ${p.range.toLocaleString()} กม.`}</span></span>
          <span class="num ${c && c.profit >= 0 ? "good" : "bad"}" style="text-align:right">${c ? `${c.profit >= 0 ? "+" : ""}${money(c.profit, true)}<br><span class="small muted">${pay ? `คืนทุน ${pay} วัน` : "ขาดทุน"}</span>` : ""}</span></button>`;
      }
      const p = st.p && plane(st.p), cost = p ? p.price + OPEN_FEE : 0;
      out += `</div><button class="btn primary big" id="go" ${!p || S.cash < cost ? "disabled" : ""}>${!p ? "ไม่มีเครื่องที่บินถึง" : S.cash < cost ? `เงินไม่พอ (ต้องใช้ ${money(cost, true)})` : `เปิดเส้นทาง · ${money(cost, true)}`}</button></div></div>`;
    }
    return out;
  };
  fn.bind = () => {
    $$("[data-sort]").forEach(b => b.onclick = () => { st.sort = b.dataset.sort; drawSheet() });
    $$("[data-to]").forEach(b => b.onclick = () => { st.to = b.dataset.to; st.p = null; drawSheet(); const s = $(".sheet"); s.scrollTop = s.scrollHeight });
    $$("[data-p]").forEach(b => b.onclick = () => { st.p = b.dataset.p; drawSheet() });
    const g = $("#go"); if (g) g.onclick = () => { if (openRoute(st.to, st.p)) { if (S.tut < 3) S.tut = 3; tab = "routes"; closeSheet() } };
  };
  return fn;
}

// Route details: what it earns, its planes, add or sell
function routeSheet(id) {
  const fn = () => {
    const r = S.routes.find(x => x.id === id); if (!r) return head("ไม่พบเส้นทาง");
    const c = routeCalc(r), to = city(r.to), rec = bestPlane(r.to, r.planes, false);
    return head(`${HUB} → ${r.to} · ${esc(to.n)}`, `${c.km.toLocaleString()} กม. · ตั๋วใบละ ${money(c.price)} · เปิดเมื่อวันที่ ${r.since}`) + `
      <div class="kpis"><div class="kpi"><small>คนอยากบิน</small><b class="num">${c.dem.toLocaleString()}</b></div><div class="kpi"><small>ขึ้นเครื่อง</small><b class="num">${c.pax.toLocaleString()}</b></div><div class="kpi"><small>กำไร/วัน</small><b class="num ${c.profit >= 0 ? "good" : "bad"}">${money(c.profit, true)}</b></div></div>
      <div class="card" style="margin-top:12px"><div class="small">รายได้ค่าตั๋ว <b class="good">${money(c.rev, true)}</b> − น้ำมัน ${money(c.fuel, true)} (${c.trips} เที่ยว/วัน) − ค่าดูแลเครื่อง ${money(c.upkeep, true)}</div>
        <div class="bar ${c.short ? "full" : ""}" style="margin-top:8px"><i style="width:${Math.round(Math.min(1, c.dem / Math.max(1, c.seats)) * 100)}%"></i></div>
        <div class="small muted" style="margin-top:4px">${c.short ? `ที่นั่งไม่พอ คนตกค้าง ${c.short.toLocaleString()} คน/วัน` : `ที่นั่งพอ ใช้ไป ${Math.round(c.lf * 100)}%`}</div></div>
      ${rec ? `<div class="explain" style="margin-top:12px">💡 เพิ่ม<b>${rec.p.n}</b> กำไรจะเพิ่มอีก <b class="good">${money(rec.gain, true)}/วัน</b> คืนทุนใน ${rec.pay} วัน</div>
        <button class="btn primary big" style="margin-top:8px" id="add" data-p="${rec.p.id}" ${S.cash < rec.p.price ? "disabled" : ""}>${S.cash < rec.p.price ? `เงินไม่พอ (${money(rec.p.price, true)})` : `+ เพิ่ม${rec.p.n} · ${money(rec.p.price, true)}`}</button>` :
        `<div class="explain" style="margin-top:12px">✅ เครื่องบินพอดีกับคนแล้ว เพิ่มเครื่องตอนนี้กำไรไม่เพิ่ม</div>`}
      <h3 style="font-size:16px;margin:16px 0 8px">เครื่องบินในเส้นทางนี้</h3><div class="pick">${r.planes.map((pid, i) => { const p = plane(pid); return `<div class="model"><span class="ico">${p.ico}</span><span><b>${p.n}</b><br><span class="small muted">${p.ex} · ${p.seats} ที่นั่ง</span></span><button class="btn" data-sell="${i}">ขาย ${money(p.price * SELL_BACK, true)}</button></div>` }).join("")}</div>
      <div class="small muted" style="margin-top:8px">ขายเครื่องได้ 70% ของราคา · ขายลำสุดท้าย = ปิดเส้นทาง</div>`;
  };
  fn.bind = () => {
    const r = S.routes.find(x => x.id === id); if (!r) return;
    const a = $("#add"); if (a) a.onclick = () => { if (addPlane(r, a.dataset.p)) drawSheet() };
    $$("[data-sell]").forEach(b => b.onclick = () => { sellPlane(r, +b.dataset.sell); if (!S.routes.includes(r)) closeSheet(); else drawSheet() });
  };
  return fn;
}

/* ---------------- start screen + coach ---------------- */
function renderStart() {
  const names = ["ฟ้าใส แอร์", "นกน้อย แอร์ไลน์", "ช้างบิน", "ทองฟ้า แอร์", "เมฆขาว"];
  $("#app").innerHTML = `<div class="start"><div class="card stack"><div style="font-size:56px">✈️</div><h1 style="font-size:28px">airline.ez</h1>
    <p class="muted" style="margin:0">สร้างสายการบินของคุณจากกรุงเทพฯ เปิดเส้นทาง ซื้อเครื่องบิน แล้วดูเงินไหลเข้า</p>
    <input id="nm" maxlength="24" value="${names[Math.floor(Math.random() * names.length)]}" aria-label="ชื่อสายการบิน">
    <button class="btn primary big" id="start">เริ่มเล่น · ทุน ${money(START_CASH, true)}</button></div></div>`;
  $("#start").onclick = () => { newGame($("#nm").value.trim()); tab = "map"; render() };
}
const COACH = [
  ["🗺️", "นี่คือแผนที่ของคุณ", "ฐานของคุณอยู่ที่กรุงเทพฯ (วงสีส้ม) จุดอื่นคือเมืองที่บินไปได้ ลากเพื่อเลื่อน กด + − เพื่อซูม"],
  ["🛫", "เปิดเส้นทางแรก", "กดปุ่ม “เปิดเส้นทางใหม่” เลือกเมือง แล้วเลือกเครื่องบิน เกมจะบอกว่ากำไรวันละเท่าไร และแนะนำเครื่องที่คุ้มที่สุด"],
  ["💰", "เงินเข้าทุกสิ้นวัน", "แถบสีส้มด้านบนคือเวลาของวัน จบวันเงินจะเข้า ถ้าเส้นไหนที่นั่งไม่พอให้เพิ่มเครื่อง กำไรถึงเป้าจะเปิดภูมิภาคใหม่"]
];
function coach() {
  if ($(".coach")) return;
  const i = S.tut, [ic, t, d] = COACH[i], el = document.createElement("div");
  el.className = "coach";
  el.innerHTML = `<div class="card"><div class="big">${ic}</div><h2>${t}</h2><p class="muted">${d}</p><div class="dots">${COACH.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>
    <button class="btn primary big">${i < COACH.length - 1 ? "ต่อไป" : "เข้าใจแล้ว เริ่มเลย!"}</button></div>`;
  document.body.appendChild(el);
  el.querySelector("button").onclick = () => { el.remove(); S.tut = i + 1; save(); if (S.tut < 3) coach() };
}
function celebrate(t, sub) {
  const el = document.createElement("div"); el.className = "levelup";
  el.innerHTML = `<div style="font-size:40px">🎉</div><b>${esc(t)}</b>${sub ? `<div class="small muted">${esc(sub)}</div>` : ""}`;
  document.body.appendChild(el); setTimeout(() => el.remove(), 3300);
  try { navigator.vibrate && navigator.vibrate([30, 60, 30]) } catch (e) {}
}
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => el.hidden = true, 2800) }

/* ---------------- map ---------------- */
const RINGS = GEO.L.map(a => { const p = new Float32Array(a.length); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  let px = null; for (let i = 0; i < a.length; i += 2) { let x = a[i] / 10; const y = a[i + 1] / 10; if (px !== null) { while (x - px > 180) x -= 360; while (x - px < -180) x += 360 } px = x; p[i] = x; p[i + 1] = y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  return {p, x0, x1, y0, y1} });
let cam = {lon: 105, lat: 12, span: 40}, camGoal = null, cv = null, hits = [];
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const wrapLon = (lon, ref) => { let l = lon; while (l - ref > 180) l -= 360; while (l - ref < -180) l += 360; return l };
function fitCam() {
  const pts = [city(HUB), ...S.routes.map(r => city(r.to))];
  if (pts.length < 2) for (const c of CITIES) if (cityOpen(c.c)) pts.push(c);
  const lons = pts.map(c => wrapLon(c.lon, city(HUB).lon)), lats = pts.map(c => c.lat);
  const lo = Math.min(...lons), hi = Math.max(...lons), la = Math.min(...lats), lb = Math.max(...lats);
  return {lon: (lo + hi) / 2, lat: (la + lb) / 2, span: clamp(Math.max(hi - lo, (lb - la) * 1.6) * 1.35 + 6, 12, 360)};
}
function camTo(t) { camGoal = t }
function initMap() {
  cv = $("#map"); if (!cv) return;
  if (!initMap.done) { cam = fitCam(); initMap.done = true }
  // drag to pan, pinch / wheel to zoom, tap a city to open it
  const pts = new Map(); let moved = 0, pinch0 = 0, span0 = 0;
  cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; camGoal = null;
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); span0 = cam.span } };
  cv.onpointermove = e => { if (!pts.has(e.pointerId)) return; const p = pts.get(e.pointerId), dx = e.clientX - p[0], dy = e.clientY - p[1]; pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch0) cam.span = clamp(span0 * pinch0 / d, 8, 360); moved += 10; return }
    const ppd = cv.clientWidth / cam.span; cam.lon -= dx / ppd / Math.cos(cam.lat * Math.PI / 180); cam.lat = clamp(cam.lat + dy / ppd, -60, 70); moved += Math.abs(dx) + Math.abs(dy) };
  const up = e => { const wasTap = pts.size === 1 && moved < 8; pts.delete(e.pointerId); if (pts.size < 2) pinch0 = 0;
    if (wasTap) { const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; let best = null, bd = 22;
      for (const h of hits) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h } }
      if (best && best.c !== HUB) { const rt = S.routes.find(q => q.to === best.c); if (rt) openSheet(routeSheet(rt.id)); else if (cityOpen(best.c)) openSheet(newRouteSheet({to: best.c})); else toast(`${city(best.c).n} เปิดที่ Lv ${regionOf(best.c).lv}`) } } };
  cv.onpointerup = up; cv.onpointercancel = up;
  cv.onwheel = e => { e.preventDefault(); cam.span = clamp(cam.span * (e.deltaY > 0 ? 1.15 : .87), 8, 360) };
}
function drawMap(now) {
  if (!cv || !cv.isConnected) return;
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr) }
  if (camGoal) { for (const k of ["lon", "lat", "span"]) cam[k] += (camGoal[k] - cam[k]) * .15; if (Math.abs(camGoal.span - cam.span) < .05) camGoal = null }
  cam.lon = wrapLon(cam.lon, 0);
  const x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ppd = W / cam.span, kx = Math.cos(cam.lat * Math.PI / 180);
  const P = (lon, lat) => [W / 2 + (wrapLon(lon, cam.lon) - cam.lon) * ppd * kx, H / 2 - (lat - cam.lat) * ppd];
  const Praw = (lon, lat) => [W / 2 + (lon - cam.lon) * ppd * kx, H / 2 - (lat - cam.lat) * ppd];
  x.fillStyle = cssv("--sea"); x.fillRect(0, 0, W, H);
  // land (drawn at the copy nearest the camera, plus neighbours across the date line)
  x.fillStyle = cssv("--land"); x.strokeStyle = cssv("--border"); x.lineWidth = .7;
  const lon0 = cam.lon - W / 2 / ppd / kx, lon1 = cam.lon + W / 2 / ppd / kx, lat0 = cam.lat - H / 2 / ppd, lat1 = cam.lat + H / 2 / ppd;
  x.beginPath();
  for (const off of [-360, 0, 360]) for (const R of RINGS) {
    if (R.x1 + off < lon0 || R.x0 + off > lon1 || R.y1 < lat0 || R.y0 > lat1) continue;
    const p = R.p; let [sx, sy] = Praw(p[0] + off, p[1]); x.moveTo(sx, sy);
    const step = cam.span > 120 ? 4 : 2;
    for (let i = step; i < p.length; i += step) { const [qx, qy] = Praw(p[i] + off, p[i + 1]); x.lineTo(qx, qy) }
    x.closePath();
  }
  x.fill(); x.stroke();
  const hub = city(HUB), [hx, hy] = P(hub.lon, hub.lat), acc = cssv("--accent"), route = cssv("--route"), ink = cssv("--ink"), muted = cssv("--muted"), paper = cssv("--paper");
  // routes + planes
  const tday = dayT;
  for (const r of S.routes) {
    const c = city(r.to); let lon = hub.lon + wrapLon(c.lon - hub.lon, 0);
    const [ax, ay] = [hx, hy], [bx, by] = Praw(wrapLon(hub.lon, cam.lon) + (lon - hub.lon), c.lat);
    const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay, cx = mx - dy * .18, cy = my + dx * .18;
    x.strokeStyle = route; x.lineWidth = 2.2; x.globalAlpha = .85; x.beginPath(); x.moveTo(ax, ay); x.quadraticCurveTo(cx, cy, bx, by); x.stroke(); x.globalAlpha = 1;
    const calc0 = routeCalc(r), n = Math.min(6, Math.max(1, Math.round(calc0.trips / 2)));
    for (let i = 0; i < n; i++) {
      let t = (tday * calc0.trips / 2 + i / n) % 1; const back = Math.floor((tday * calc0.trips / 2 + i / n) % 2) === 1; if (back) t = 1 - t;
      const px = (1 - t) ** 2 * ax + 2 * (1 - t) * t * cx + t * t * bx, py = (1 - t) ** 2 * ay + 2 * (1 - t) * t * cy + t * t * by;
      const tx = 2 * (1 - t) * (cx - ax) + 2 * t * (bx - cx), ty = 2 * (1 - t) * (cy - ay) + 2 * t * (by - cy), ang = Math.atan2(ty, tx) + (back ? Math.PI : 0);
      x.save(); x.translate(px, py); x.rotate(ang); const zs = clamp(ppd / 14, .55, 1); x.scale(zs, zs); x.fillStyle = paper; x.strokeStyle = ink; x.lineWidth = 1.2;
      x.beginPath(); x.moveTo(9, 0); x.lineTo(-6, -6); x.lineTo(-3, 0); x.lineTo(-6, 6); x.closePath(); x.fill(); x.stroke(); x.restore();
    }
  }
  // cities
  hits = []; x.font = "600 12px 'IBM Plex Sans Thai', sans-serif"; x.textBaseline = "middle";
  const served = new Set(S.routes.map(r => r.to)), labels = [];
  for (const c of CITIES) {
    const [px, py] = P(c.lon, c.lat); if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;
    const open = cityOpen(c.c), on = served.has(c.c), isHub = c.c === HUB, rad = isHub ? 7 : on ? 5 : 3 + Math.min(2, c.w / 8);
    x.globalAlpha = open ? 1 : .35; x.beginPath(); x.arc(px, py, rad, 0, 7);
    x.fillStyle = isHub ? acc : on ? route : muted; x.fill(); if (isHub || on) { x.lineWidth = 2; x.strokeStyle = paper; x.stroke() }
    if (S.ev && S.ev.city === c.c && S.ev.until >= S.day) { x.strokeStyle = cssv("--warn"); x.lineWidth = 2; x.beginPath(); x.arc(px, py, rad + 5 + 3 * Math.sin(now / 250), 0, 7); x.stroke() }
    x.globalAlpha = 1; hits.push({c: c.c, x: px, y: py});
    if (isHub || on || (open && (cam.span < 50 || c.w >= 12))) labels.push({t: c.n, x: px + rad + 4, y: py, pr: isHub ? 3 : on ? 2 : 1});
  }
  // hub pulse
  x.strokeStyle = acc; x.lineWidth = 2; x.globalAlpha = 1 - (now / 1500 % 1); x.beginPath(); x.arc(hx, hy, 7 + 16 * (now / 1500 % 1), 0, 7); x.stroke(); x.globalAlpha = 1;
  // labels without overlaps
  labels.sort((a, b) => b.pr - a.pr); const boxes = [];
  for (const l of labels) { const w = x.measureText(l.t).width, b = [l.x - 2, l.y - 9, l.x + w + 2, l.y + 9];
    if (boxes.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) continue; boxes.push(b);
    x.lineWidth = 3; x.strokeStyle = paper; x.strokeText(l.t, l.x, l.y); x.fillStyle = l.pr > 1 ? ink : muted; x.fillText(l.t, l.x, l.y) }
  // money floating up from each route at the end of the day
  floaters = floaters.filter(f => now - f.t < 1800);
  x.font = "700 13px Prompt, sans-serif"; const fb = [];
  for (const f of floaters) { const c = city(f.to), [px, py] = P(c.lon, c.lat), k = (now - f.t) / 1800, bb = [px + 6, py - 26, px + 90, py - 6];
    if (fb.some(o => bb[0] < o[2] && bb[2] > o[0] && bb[1] < o[3] && bb[3] > o[1])) continue; fb.push(bb);
    x.globalAlpha = 1 - k; x.fillStyle = f.v >= 0 ? cssv("--good") : cssv("--bad"); x.lineWidth = 3; x.strokeStyle = paper;
    const t = (f.v >= 0 ? "+" : "") + money(f.v, true); x.strokeText(t, px + 8, py - 14 - k * 24); x.fillText(t, px + 8, py - 14 - k * 24); x.globalAlpha = 1 }
}

/* ---------------- main loop ---------------- */
function frame(now) {
  const dt = Math.min(250, now - last); last = now;
  if (S && !$(".coach") && S.speed > 0) {
    dayT += dt * S.speed / DAY_MS;
    if (dayT >= 1) { dayT -= 1; endDay() }
  }
  const bar = $("#daybar"); if (bar) bar.style.width = (dayT * 100).toFixed(1) + "%";
  if (S && tab === "map") drawMap(now);
  requestAnimationFrame(frame);
}
document.addEventListener("visibilitychange", () => { if (document.hidden && S) save() });

S = load();
render();
requestAnimationFrame(frame);
