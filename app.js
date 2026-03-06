// ====== CONFIG ======
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTHkC7phRGZ2fGFJdPqp19D8faQiXNnjZCNXWWnmPGT6jG_jlNkbwso42HMzTqsU78MVXBIlzHRtkW8/pub?gid=0&single=true&output=csv";

// ====== STATE ======
let DATA = [];
let map = null;
let markersLayer = null;
let mapInitialized = false;

// ====== DOM ======
const el = (id) => document.getElementById(id);

const mapWrap = el("mapWrap");
const toggleMapBtn = el("toggleMapBtn");
const refreshBtn = el("refreshBtn");
const fitAllBtn = el("fitAllBtn");

const qInput = el("q");
const districtSelect = el("district");
const stageSelect = el("stage");
const ruleSelect = el("rule");

const tbody = el("tbody");
const districtList = el("districtList");

// counters
const cSchools = el("cSchools");
const cYaseer = el("cYaseer");
const cADHD = el("cADHD");
const cAllowed = el("cAllowed");
const cDistricts = el("cDistricts");

// --- Marker Color Logic ---
function markerColor(total){
  if (!total || total === "-" || total === "") return "gray";
  total = Number(total);
  if (isNaN(total)) return "gray";
  return total >= 1000 ? "red" : "green";
}

// --- Marker Icon Loader ---
function makeIcon(color){
  return L.icon({
    iconUrl: `./icons/${color}.png`,
    iconSize: [34, 42],
    iconAnchor: [17, 42],
    popupAnchor: [0, -40],
  });
}



// ====== CSV PARSER (supports quotes) ======
function parseCSV(text){
  const rows = [];
  let row = [], cell = "", inQuotes = false;

  for (let i=0;i<text.length;i++){
    const c = text[i], n = text[i+1];

    if (c === '"'){
      if (inQuotes && n === '"'){ cell += '"'; i++; }
      else inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && c === ','){
      row.push(cell); cell=""; continue;
    }

    if (!inQuotes && (c === '\n' || (c === '\r' && n === '\n'))){
      if (c === '\r') i++;
      row.push(cell); rows.push(row);
      row=[]; cell=""; continue;
    }

    cell += c;
  }

  if (cell.length || row.length){
    row.push(cell);
    rows.push(row);
  }

  const headers = (rows[0]||[]).map(h => String(h).trim().toLowerCase());
  return rows.slice(1).map(r => {
    const o = {};
    headers.forEach((h,i)=> o[h] = (r[i] ?? "").toString().trim());
    return o;
  });
}

// ====== HELPERS ======
function normNum(x){
  const s = String(x ?? "").trim();
  if (!s) return "";
  const ar="٠١٢٣٤٥٦٧٨٩";
  let t="";
  for (const ch of s) t += (ar.includes(ch) ? ar.indexOf(ch) : ch);
  const n = Number(t);
  return Number.isFinite(n) ? n : "";
}

function ruleOf(total){
  const t = normNum(total);
  if (t === "") return "unknown";
  if (t > 1000) return "blocked";
  return "allowed";
}

function pillHTML(r){
  if (r === "allowed") return `<span class="pill ok">أخضر</span>`;
  if (r === "blocked") return `<span class="pill bad">أحمر</span>`;
  return `<span class="pill unk">رمادي</span>`;
}

function cardClass(total){
  const r = ruleOf(total);
  return r === "allowed" ? "allowed" : r === "blocked" ? "blocked" : "unknown";
}

function getFilters(){
  return {
    q: qInput.value.trim(),
    ds: districtSelect.value.trim(),
    st: stageSelect.value.trim(),
    ru: ruleSelect.value.trim(),
  };
}

function applyFilters(list){
  const {q, ds, st, ru} = getFilters();
  return list.filter(s => {
    const okQ = !q || (s.name||"").includes(q);
    const okD = !ds || (s.district||"") === ds;
    const okS = !st || (s.stage||"") === st;
    const okR = !ru || ruleOf(s.total) === ru;
    return okQ && okD && okS && okR;
  });
}

// ====== DISTRICTS DROPDOWN (auto from sheet) ======
function buildDistrictOptions(){
  const districts = [...new Set(
    DATA
      .map(s => (s.district||"").trim())
      .filter(x => x !== "")
  )].sort((a,b)=> a.localeCompare(b, "ar"));

  districtSelect.innerHTML =
    `<option value="">كل الأحياء</option>` +
    districts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");

  cDistricts.textContent = districts.length;
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// ====== RENDER TABLE + STATS + DISTRICT DISTRIBUTION ======
function renderAll(){
  const filtered = applyFilters(DATA);

  // Stats
  const sumY = filtered.reduce((a,s)=> a + (normNum(s.yaseer) || 0), 0);
  const sumA = filtered.reduce((a,s)=> a + (normNum(s.adhd) || 0), 0);
  const allowedCount = filtered.filter(s => ruleOf(s.total)==="allowed").length;

  cSchools.textContent = filtered.length;
  cYaseer.textContent = sumY;
  cADHD.textContent = sumA;
  cAllowed.textContent = allowedCount;


  // Table
  tbody.innerHTML = filtered.map(s => {
    const r = ruleOf(s.total);
    return `
      <tr>
        <td>${escapeHtml(s.name||"")}</td>
        <td>${escapeHtml(s.district||"—")}</td>
        <td>${escapeHtml(s.stage||"")}</td>
        <td>${normNum(s.yaseer)==="" ? "—" : normNum(s.yaseer)}</td>
        <td>${normNum(s.adhd)==="" ? "—" : normNum(s.adhd)}</td>
        <td>${normNum(s.pending)==="" ? "—" : normNum(s.pending)}</td>
        <td>${normNum(s.total)==="" ? "—" : normNum(s.total)}</td>
        <td>${pillHTML(r)}</td>
      </tr>
    `;
  }).join("");

  // District distribution (top 10) from filtered data
  const freq = new Map();
  filtered.forEach(s => {
    const d = (s.district||"").trim();
    if (!d) return;
    freq.set(d, (freq.get(d)||0) + 1);
  });

  const top = [...freq.entries()]
    .sort((a,b)=> b[1]-a[1])
    .slice(0,10);

  districtList.innerHTML = top.length
    ? top.map(([d,c]) => `
        <div class="drow">
          <div class="name">${escapeHtml(d)}</div>
          <div class="count">${c} مدارس</div>
        </div>
      `).join("")
    : "—";

  // Map
  if (mapInitialized) renderMap(filtered);
}

// ====== MAP ======
function initMapIfNeeded(){
  if (mapInitialized) return;

  map = L.map('map').setView([21.543, 39.172], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);

  mapInitialized = true;

  // Leaflet needs this after show
  setTimeout(() => map.invalidateSize(), 80);
}

function renderMap(filtered){
  markersLayer.clearLayers();

  const points = [];

  filtered.forEach(s => {
    const lat = normNum(s.lat);
    const lng = normNum(s.lng);
    if (lat === "" || lng === "") return;

    const cls = cardClass(s.total);

    const html = `
      <div class="school-card ${cls}">
        <div style="font-weight:900; margin-bottom:6px;">${escapeHtml(s.name||"بدون اسم")}</div>
        <div class="srow"><span>الحي</span><span>${escapeHtml(s.district||"—")}</span></div>
        <div class="srow"><span>المرحلة</span><span>${escapeHtml(s.stage||"—")}</span></div>
        <div class="srow"><span>يسير</span><span>${normNum(s.yaseer) === "" ? "—" : normNum(s.yaseer)}</span></div>
        <div class="srow"><span>فرط الحركة</span><span>${normNum(s.adhd) === "" ? "—" : normNum(s.adhd)}</span></div>
        <div class="srow"><span>إجمالي الطلاب</span><span>${normNum(s.total) === "" ? "—" : normNum(s.total)}</span></div>
      </div>
    `;

const color = markerColor(s.total);

L.marker([lat, lng], { icon: makeIcon(color) })
  .addTo(markersLayer)
  .bindPopup(html);

points.push([lat, lng]);
  });

  if (points.length){
    map.fitBounds(points, { padding:[30,30] });
  }
}

function fitAll(){
  if (!mapInitialized) return;

  const points = [];
  DATA.forEach(s => {
    const lat = normNum(s.lat);
    const lng = normNum(s.lng);
    if (lat !== "" && lng !== "") points.push([lat, lng]);
  });

  if (points.length) map.fitBounds(points, { padding:[30,30] });
}

// ====== DATA LOAD ======
async function reloadData(){
  try{
    const res = await fetch(SHEET_CSV_URL);
    const csv = await res.text();
    DATA = parseCSV(csv);

    buildDistrictOptions();
    renderAll();
  }catch(e){
    alert("تعذّر تحميل البيانات. تأكد إن الشيت منشور (Publish to web) ورابط CSV صحيح.");
    console.error(e);
  }
}

// ====== EVENTS ======
function wireEvents(){
  // Filters
  qInput.addEventListener("input", renderAll);
  districtSelect.addEventListener("change", renderAll);
  stageSelect.addEventListener("change", renderAll);
  ruleSelect.addEventListener("change", renderAll);

  // Map toggle
  toggleMapBtn.addEventListener("click", () => {
    const show = !mapWrap.classList.contains("show");
    mapWrap.classList.toggle("show", show);
    toggleMapBtn.textContent = show ? "إخفاء الخريطة" : "إظهار الخريطة";

    if (show){
      initMapIfNeeded();
      setTimeout(() => { map.invalidateSize(); renderAll(); }, 120);
    }
  });

  // Refresh + fit
  refreshBtn.addEventListener("click", reloadData);
  fitAllBtn.addEventListener("click", () => {
  // لو الخريطة مو جاهزة، جهّزها أول ثم سوّ توسيط
  if (!mapInitialized){
    mapWrap.classList.add("show");
    initMapIfNeeded();
    setTimeout(() => { map.invalidateSize(); fitAll(); }, 120);
    return;
  }
  fitAll();
});
}

// ====== INIT ======
wireEvents();
reloadData();
