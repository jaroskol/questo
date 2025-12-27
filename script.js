let plannedSong = null; // { id, t, rawTitle }
let runShieldActive = false;
let roundLocked = false;
let runBankGained = 0;     // ile wpadło do banku w tym runie
let runBestStreak = 0;     // najlepszy streak w runie
let runCorrect = 0;        // ile trafień w runie
let initialsPool = [];      // unikalne litery z tytułu
let initialsRevealed = [];  // już odkryte litery (w kolejności)
let roundStartTs = 0;
let hintUsedThisRound = false;
let runUnbreakUsed = false; // UNBREAKABLE użyte w tym runie?
let runThickCounter = 0;
let cloudSyncLocked = false;

const SUPABASE_URL = "https://cvkyfxznlnhiuokaoosb.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2a3lmeHpubG5oaXVva2Fvb3NiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3ODYxOTksImV4cCI6MjA4MjM2MjE5OX0.oJiSR10B11UpGW0w-Ec0OAr23W7Vaf6LvuZ1l_l7jwQ";
const supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let cloudUser = null;
let cloudSaveTimer = null;

async function supaHealthcheck() {
  try {
    const t = setTimeout(() => { throw new Error("timeout"); }, 5000);
    const res = await supa.auth.getSession();
    clearTimeout(t);
    return !!res?.data?.session;
  } catch (e) {
    return false;
  }
}


async function getUserId() {
  const { data } = await supa.auth.getSession();
  return data?.session?.user?.id || null;
}

// 1) Przy starcie strony: jeśli jest sesja, ustaw usera i zaciągnij zapis
(async function initCloudSession(){
  const { data } = await supa.auth.getSession();
  cloudUser = data?.session?.user || null;
  refreshCloudLabel();
  if (cloudUser) {
    await cloudPull();      // <- najważniejsze (pobiera wspólny progres)
  }
})();

function openAuth(){
  const ov = document.getElementById("authOverlay");
  if (!ov) return;

  ov.classList.remove("hidden");
  ov.style.setProperty("display", "flex", "important");
  ov.style.setProperty("pointer-events", "auto", "important");
}

function closeAuth(){
  const ov = document.getElementById("authOverlay");
  if (!ov) return;

  ov.classList.add("hidden");
  ov.style.setProperty("display", "none", "important");
  ov.style.setProperty("pointer-events", "none", "important");
}

// === Jeden jedyny handler auth state (usuń duplikaty!) ===
supa.auth.onAuthStateChange(async (event, session) => {
  cloudUser = session?.user || null;
  refreshCloudLabel();

  const accountOverlay = document.getElementById("accountOverlay");

  const hideAccount = () => {
    if (!accountOverlay) return;
    accountOverlay.style.display = "none";
    accountOverlay.style.pointerEvents = "none";
  };

  const showAccount = () => {
    if (!accountOverlay) return;
    accountOverlay.style.display = "flex";
    accountOverlay.style.pointerEvents = "auto";
  };

  if (cloudUser) {
    // pokaż konto zawsze gdy zalogowany (nie tylko SIGNED_IN)
    showAccount();

    // po zalogowaniu / odświeżeniu sesji zaciągnij stan
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
      try { await cloudPull(); } catch (e) { console.warn("cloudPull failed:", e); }
    }

    startAutoSync30s();
  } else {
    hideAccount();
    stopAutoSync30s();
  }
});
function toggleAccountPanel(){
  const ov = document.getElementById("accountOverlay");
  if (!ov) return;

  const willShow = (ov.style.display === "none" || !ov.style.display);

  ov.style.display = willShow ? "flex" : "none";
  ov.style.pointerEvents = willShow ? "auto" : "none"; // <-- KLUCZ
}



function clearQuestlyStorage() {
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;

    // usuń TYLKO swoje klucze:
    if (k.startsWith("questly_")) toRemove.push(k);

    // jeśli masz jakieś inne swoje stałe klucze, dopisz je tu:
    // if (k === "meta") toRemove.push(k);
  }
  toRemove.forEach(k => localStorage.removeItem(k));
}

let autoSyncTimer = null;

function startAutoSync30s() {
  stopAutoSync30s();
  autoSyncTimer = setInterval(() => {
    // pull jest bezpieczniejszy niż push w tle (nie nadpisuje “obcym” stanem)
    cloudPull().catch(e => console.warn("auto cloudPull failed:", e));
  }, 30000);
}

function stopAutoSync30s() {
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  autoSyncTimer = null;
}
function hintMeta(key){
  const info = (typeof HINT_INFO !== "undefined" && HINT_INFO && HINT_INFO[key]) ? HINT_INFO[key] : null;
  if (info) return { icon: info.icon || "✨", title: info.title || key };

  const fallback = {
    initials: { icon:"🔡", title:"Litery tytułu" },
    artist:   { icon:"👤", title:"Wykonawca" },
    time:     { icon:"⏳", title:"Dodatkowy czas" },
    "5titles":{ icon:"🎯", title:"Lista 5 opcji" },
  };
  return fallback[key] || { icon:"✨", title:key };
}

function showStartHintsModal(added){
  if (!added || !added.length) return;

  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;";

  const items = added.map(k => {
    const m = hintMeta(k);
    return `<div style="display:flex;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid rgba(255,255,255,.12);border-radius:12px;">
      <div style="display:flex;gap:10px;align-items:center;">
        <span style="font-size:18px">${m.icon}</span>
        <b>${m.title}</b>
      </div>
      <span style="opacity:.9">+1</span>
    </div>`;
  }).join("");

  const box = document.createElement("div");
  box.style.cssText = "width:min(520px,92vw);background:#12161b;border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:16px;color:#fff;";
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px">
      <div>
        <div style="font-size:12px;opacity:.8">START RUNA</div>
        <div style="font-size:18px;font-weight:800">Dodatkowe podpowiedzi na start</div>
      </div>
      <button id="startHintClose" style="background:rgba(255,255,255,.12);border:0;color:#fff;border-radius:12px;padding:8px 10px;cursor:pointer">OK</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">${items}</div>
  `;

  ov.appendChild(box);
  document.body.appendChild(ov);

  const close = () => ov.remove();
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  box.querySelector("#startHintClose").addEventListener("click", close);
}


function updateContinueBtnVisibility() {
  // u Ciebie "Continue" jest 3. przyciskiem w .start-actions
  const contBtn = document.querySelector("#startScreen .start-actions button:nth-child(3)");
  if (!contBtn) return;

  const canContinue = !!stats?.playerClass;

  // jak nie ma klasy => brak kontynuacji
  contBtn.style.display = canContinue ? "" : "none";
  contBtn.disabled = !canContinue;
}

function refreshBankUI() {
  ensureMeta();
  cloudPush(false);
  // BANK w overlay drzewka
  const bankEl = document.getElementById("bankVal");
  if (bankEl) bankEl.textContent = meta.bank.toLocaleString("pl-PL");

  // jeśli kiedyś dodasz bank gdzieś indziej — dopisz kolejne elementy tutaj
}

function loseHeart(amount = 1) {
  const dodgeLvl = (typeof meta !== "undefined" && meta?.upgrades?.dodge_heart) ? meta.upgrades.dodge_heart : 0;
  const dodgeChance = Math.min(0.30, dodgeLvl * 0.10);

  let lost = 0;

  for (let i = 0; i < amount; i++) {
    if (dodgeChance > 0 && Math.random() < dodgeChance) {
      showFloatingText?.("🍀 UNIK!", "var(--gold)");
      continue;
    }
    if (typeof runShieldActive !== "undefined" && runShieldActive) {
      runShieldActive = false;
      showFloatingText?.("🛡️ TARCZA!", "var(--gold)");
      continue;
    }
    if (hasPerk("perk_w_thick")) {
      runThickCounter++;
      if (runThickCounter % 3 === 0) {
    showFloatingText?.("🛡️ PANCERZ!", "var(--gold)");
    continue; // anuluj co 3 utratę
    }
  }


    stats.hearts = (stats.hearts || 0) - 1;
    lost++;
  }

  updateHeroOverlay?.();
  updateRPG?.();

  if ((stats.hearts || 0) <= 0) {
    setRoundLocked?.(true);
    try { player?.pauseVideo?.(); } catch (e) {}
    if (typeof gameOver === "function") gameOver();
  }

  return lost;
}
window.loseHeart = loseHeart;

function setRoundLocked(v) {
  roundLocked = !!v;

  const input = document.getElementById("guessInput");
  const okBtn = document.querySelector(".btn-main"); // przycisk OK
  const replayBtn = document.querySelector(".btn-replay");

  if (input) input.disabled = roundLocked;
  if (okBtn) okBtn.disabled = roundLocked;
  if (replayBtn) replayBtn.disabled = roundLocked;
}

(function setupResponsiveRerender(){
  let t = null;
  const rerender = () => {
    // odświeżaj tylko jeśli overlay drzewka jest otwarty
    if (document.getElementById("skillOverlay")) {
      try { renderTreesUI(); } catch(e) {}
    }
  };

  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(rerender, 120);
  });

  // mobile rotation / viewport changes
  window.addEventListener("orientationchange", () => {
    setTimeout(rerender, 200);
  });
})();


function ensureYTPlayer() {
  // jeśli już gotowe – nic nie rób
  if (apiReady) return;

  // jeśli API jest, ale player jeszcze nieutworzony → utwórz
  if (window.YT && YT.Player) {
    try {
      if (!player) onYouTubeIframeAPIReady();
    } catch (e) {
      console.warn("Nie udało się utworzyć playera:", e);
    }
    return;
  }

  // jeśli API nie ma – doładuj skrypt (fallback na blokady/wyścigi)
  if (!document.getElementById("yt-iframe-api-fallback")) {
    const s = document.createElement("script");
    s.id = "yt-iframe-api-fallback";
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => {
      console.error("Nie mogę załadować YouTube IFrame API (blokada/AdBlock?).");
      showFloatingText("🚫 YouTube zablokowany (AdBlock?)", "var(--error)");
    };
    document.head.appendChild(s);
  }
}

function showLevelUpNotice({ fromLvl, toLvl, gainedHearts, unlockedPerks }) {
  const perksHtml = (unlockedPerks && unlockedPerks.length)
    ? `
      <div style="margin-top:12px; text-align:left;">
        <div style="font-size:0.75rem; letter-spacing:2px; color:var(--gold); margin-bottom:6px;">
          ODBLOKOWANO
        </div>
        ${unlockedPerks.map(p => `
          <div style="margin:6px 0; opacity:0.95;">
            <b>${p.icon} ${p.name}</b>
            <div style="font-size:0.78rem; opacity:0.7;">${p.desc}</div>
          </div>
        `).join("")}
      </div>
    `
    : "";

  const ov = document.createElement("div");
  ov.style.cssText = `
    position:fixed; inset:0; z-index:5000;
    background:rgba(0,0,0,0.72);
    display:flex; align-items:center; justify-content:center;
  `;

  ov.innerHTML = `
    <div style="
      width:min(520px, 92vw);
      padding:22px 20px;
      border-radius:18px;
      border:2px solid var(--gold);
      background:linear-gradient(135deg, rgba(26,26,46,0.95), rgba(22,33,62,0.95));
      box-shadow:0 30px 80px rgba(0,0,0,0.6);
      text-align:center;">
      
      <div style="font-size:1.8rem; margin-bottom:6px;">⬆️</div>
      <div style="font-weight:900; letter-spacing:2px; color:var(--gold);">
        LEVEL UP!
      </div>
      <div style="margin-top:6px; font-size:1.1rem; font-weight:900;">
        LVL ${fromLvl} → ${toLvl}
      </div>

      <div style="margin-top:10px; opacity:0.9;">
        ❤️ +${gainedHearts} serce
      </div>

      ${perksHtml}

      <button id="lvlUpOkBtn" style="
        margin-top:16px; width:100%;
        padding:10px 12px;
        border-radius:12px;
        border:1px solid rgba(255,255,255,0.12);
        background:rgba(255,255,255,0.06);
        color:#fff; font-weight:900; cursor:pointer;">
        OK
      </button>
    </div>
  `;

  document.body.appendChild(ov);

  const kill = () => { try { ov.remove(); } catch(e) {} };
  ov.querySelector("#lvlUpOkBtn")?.addEventListener("click", kill);
  ov.addEventListener("click", (e) => { if (e.target === ov) kill(); });

  // opcjonalnie auto-zamknięcie po 4s:
  setTimeout(kill, 4000);
}
function closeHintHelp() {
  const panel = document.getElementById("hintHelpPanel");
  if (panel) panel.classList.add("hidden");
}

function showScreen(id) {
  closeHintHelp();

  // ✅ RESET EFEKTÓW UI przy wychodzeniu z gry (menu/klasy)
  const vignette = document.getElementById("vignette");
  vignette?.classList.remove("low-hp-active");
  document.body.classList.remove("fever-mode");

  ["startScreen", "classScreen", "selectScreen", "gameScreen"].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.add("hidden");
  });

  const target = document.getElementById(id);
  if (target) target.classList.remove("hidden");
}

function ensureTreeTooltip(){
  let el = document.getElementById("treeTooltip");
  if (el) return el;

  el = document.createElement("div");
  el.id = "treeTooltip";
  el.className = "tree-tooltip";
  document.body.appendChild(el);
  return el;
}

function classNameForNodeId(id){
  if (!id) return "";
  if (id.startsWith("perk_w_")) return "Wojownik ⚔️";
  if (id.startsWith("perk_r_")) return "Łotr 🎯";
  if (id.startsWith("perk_m_")) return "Mag ✨";
  return "";
}

function nodeNameById(tab, id){
  const n = (TREES?.[tab]?.nodes || []).find(x => x.id === id);
  return n ? `${n.icon || "✨"} ${n.name}` : id;
}

function formatReq(tab, node){
  const req = node?.req || [];
  if (!req.length) return "Brak (startowy węzeł)";
  return req.map(r => `• ${nodeNameById(tab, r.id)}`).join("<br>");
}

function showTreeTooltip(e, tab, node, chk, cost, owned){
  const tt = ensureTreeTooltip();
  const cls = classNameForNodeId(node.id);

  const status =
    owned ? "✅ Kupione"
    : (chk?.ok ? "🟡 Dostępne" : "🔒 Zablokowane");

  const why =
    owned ? "Permanentne"
    : (chk?.ok ? "Możesz kupić teraz" : (chk?.reason || "Nie spełniasz wymagań"));

  tt.innerHTML = `
    <div class="tt-title">${node.icon || "✨"} ${node.name}</div>

    ${cls ? `<div style="margin-bottom:8px;"><span class="tt-pill">${cls}</span></div>` : ""}

    <div class="tt-row"><span>Status</span><b>${status}</b></div>
    <div class="tt-row"><span>Koszt</span><b>${owned ? "—" : `💰 ${cost}`}</b></div>

    <div style="opacity:.85; margin-top:6px;">${why}</div>

    <div class="tt-req">
      <div style="font-weight:900; margin-bottom:6px;">Wymagania</div>
      <div>${formatReq(tab, node)}</div>
    </div>
  `;

  const pad = 14;
  const x = Math.min(window.innerWidth - pad, e.clientX + 14);
  const y = Math.min(window.innerHeight - pad, e.clientY + 14);
  tt.style.left = x + "px";
  tt.style.top = y + "px";
  tt.classList.add("show");
}

function moveTreeTooltip(e){
  const tt = document.getElementById("treeTooltip");
  if (!tt || !tt.classList.contains("show")) return;
  const pad = 14;
  const x = Math.min(window.innerWidth - pad, e.clientX + 14);
  const y = Math.min(window.innerHeight - pad, e.clientY + 14);
  tt.style.left = x + "px";
  tt.style.top = y + "px";
}

function hideTreeTooltip(){
  const tt = document.getElementById("treeTooltip");
  if (!tt) return;
  tt.classList.remove("show");
}


function baseHeartsForClass(cls) {
  // dopasuj do Twoich klas jeśli masz inne wartości
  if (cls === "warrior") return 7;
  if (cls === "mage") return 5;
  if (cls === "rogue") return 5;
  return 5;
}

function resetRunKeepClass() {
  runUnbreakUsed = false;
  // reset runu
  stats.points = 0;
  stats.xp = 0;
  stats.lvl = 1;
  stats.streak = 0;
  stats.currentStage = 1;
  stats.guessedSongIds = [];
  stats.rewindUsed = false;
  stats.mistakesTotal = 0;

  // serca startowe = baza klasy + upgrady
  const cls = stats.playerClass;
  stats.hearts = baseHeartsForClass(cls);

  if (typeof ensureMeta === "function") {
    ensureMeta();
    stats.hearts += (meta?.upgrades?.start_hearts || 0);
  }

  // restart run-summary (jeśli używasz)
  if (typeof runBankGained !== "undefined") runBankGained = 0;
  if (typeof runBestStreak !== "undefined") runBestStreak = 0;
  if (typeof runCorrect !== "undefined") runCorrect = 0;

  localStorage.setItem("questly_v77", JSON.stringify(stats));
}


function goBackToMap() {
  setRoundLocked(false);

  if (player && player.pauseVideo) player.pauseVideo();

  document.getElementById('gameScreen')?.classList.add('hidden');
  document.getElementById('selectScreen')?.classList.remove('hidden');
  generatePaths?.();
}

function mergeMeta(localMeta = {}, cloudMeta = {}) {
  const A = localMeta || {};
  const B = cloudMeta || {};

  const out = {
    bank: Math.max(Number(A.bank || 0), Number(B.bank || 0)),
    upgrades: {},
    unlocked: {}
  };

  // upgrades: bierz wyższy poziom
  const upA = A.upgrades || {};
  const upB = B.upgrades || {};
  for (const k of new Set([...Object.keys(upA), ...Object.keys(upB)])) {
    out.upgrades[k] = Math.max(Number(upA[k] || 0), Number(upB[k] || 0));
  }

  // unlocked: true wygrywa
  const unA = A.unlocked || {};
  const unB = B.unlocked || {};
  for (const k of new Set([...Object.keys(unA), ...Object.keys(unB)])) {
    out.unlocked[k] = !!(unA[k] || unB[k]);
  }

  return out;
}

function pickBetterStats(localStats = {}, cloudStats = {}) {
  const A = localStats || {};
  const B = cloudStats || {};

  // prosta heurystyka: wybierz "bardziej zaawansowany" zapis
  const aLvl = Number(A.lvl || 1), bLvl = Number(B.lvl || 1);
  if (aLvl !== bLvl) return aLvl > bLvl ? A : B;

  const aXp = Number(A.xp || 0), bXp = Number(B.xp || 0);
  if (aXp !== bXp) return aXp > bXp ? A : B;

  const aTot = Number(A.totalCorrect || 0), bTot = Number(B.totalCorrect || 0);
  if (aTot !== bTot) return aTot > bTot ? A : B;

  return B; // domyślnie chmura
}

function finishRunVictory(diffKey) {
  const d = DIFFICULTIES[diffKey] || DIFFICULTIES.easy;

  // --- WYLICZ PODSUMOWANIE ZANIM COKOLWIEK ZRESETUJESZ ---
  // W momencie zwycięstwa stats.currentStage jest zwykle = maxStage + 1
  const stageReached = Math.min(d.maxStage, (stats.currentStage || 1) - 1);
  const runPoints = stats.points || 0;

  // bonus banku za ukończenie
  const winBonusBank = Math.floor(5000 * d.mult);

  // dopisz bonus do banku ORAZ do runBankGained (żeby ekran to pokazał)
  ensureMeta();
  meta.bank += winBonusBank;
  saveMeta();
  cloudPush(false);
  runBankGained += winBonusBank;

  const summary = {
    stageReached,
    runPoints,
    bankGained: runBankGained
  };

  // --- POKAŻ EKRAN WYGRANEJ (NA STARYCH WARTOŚCIACH) ---
  showRunResultModal({
    type: "WIN",
    title: "RUN UKOŃCZONY!",
    icon: "🏆",
    diffKey,
    summary
  });

  // --- TERAZ dopiero reset runu, żeby można było zagrać jeszcze raz ---
  stats.currentStage = 1;
  stats.streak = 0;
  stats.guessedSongIds = [];
  stats.rewindUsed = false;
  stats.points = 0;

  // wyzeruj summary na kolejny run (zostaw bank/meta!)
  runCorrect = 0;
  runBestStreak = 0;
  runBankGained = 0;

  localStorage.setItem("questly_v77", JSON.stringify(stats));
}

function normalizeGuess(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // usuń akcenty
    .replace(/[^a-z0-9ąćęłńóśżź ]/gi, " ")            // wywal znaki
    .replace(/\s+/g, " ")
    .trim();
}

// Wyciąga „tytuł utworu” z "Artist - Title" albo "Title (Official Video)"
function getSongTitleOnly(fullTitle) {
  const t = normalizeGuess(fullTitle);

  // często YouTube ma "ARTIST - TITLE"
  const parts = t.split(" - ");
  const maybeTitle = parts.length >= 2 ? parts.slice(1).join(" - ") : t;

  // utnij rzeczy typu "(official video)", "[lyrics]" itp. jeśli chcesz
  return maybeTitle
    .replace(/\(.*?\)/g, " ")
    .replace(/\[.*?\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCorrectGuess(userInput, fullTitle) {
  const g = normalizeGuess(userInput);
  if (g.length < 4) return false; // krótsze strzały nie liczą się

  const title = getSongTitleOnly(fullTitle);
  if (!title) return false;

  // jeśli ktoś wpisał prawie cały tytuł → OK
  if (title === g) return true;

  // jeśli wpis jest sensowną częścią tytułu (min 60% długości wpisu względem tytułu)
  if (title.includes(g)) {
    const ratio = g.length / Math.max(1, title.length);
    if (ratio >= 0.6) return true;
  }

  // alternatywnie: wszystkie słowa z wpisu muszą wystąpić w tytule
  const words = g.split(" ").filter(w => w.length >= 3);
  if (words.length >= 2 && words.every(w => title.includes(w))) return true;

  return false;
}

function generatePaths() {
const d = DIFFICULTIES[selectedDifficulty] || DIFFICULTIES.easy;
if ((stats.currentStage || 1) > d.maxStage) {
  finishRunVictory(selectedDifficulty);
  return;
}

  if (!stats.currentStage) stats.currentStage = 1;

  const stageEl = document.getElementById("currentStage");
  if (stageEl) stageEl.innerText = stats.currentStage;

  const container = document.getElementById("pathChoices");
  if (!container) return;
  container.innerHTML = "";

  // --- helper: ujednolica pola niezależnie od tego jak wyglądają obiekty w ALL_PATHS
  const normalizePath = (path) => {
    const isEvent = path.type === "EVENT";

    // Z ALL_PATHS często jest np. name/icon/desc zamiast n/i/desc
    const n = path.n ?? path.name ?? path.title ?? "Nieznany szlak";
    const i = path.i ?? path.icon ?? "❓";
    const desc = path.desc ?? path.description ?? "Nieznany szlak.";

    // id: eventy nie potrzebują id, ale ścieżki do startGame muszą mieć jakąś wartość
    const id = path.id ?? path.pid ?? path.key ?? n; // awaryjnie nazwa

    return { ...path, type: isEvent ? "EVENT" : (path.type ?? "PATH"), n, i, desc, id };
  };

  // Losujemy 2 zwykłe ścieżki
  const shuffled = [...ALL_PATHS].sort(() => 0.5 - Math.random()).slice(0, 2);

  const pickedIds = new Set(shuffled.map(p => p.id));

  const eventRoll = Math.random();
  let specialCard;

  if (eventRoll > 0.92) {
    specialCard = { n: "Złota Skrzynia", i: "🎁", type: "EVENT", desc: "Darmowe łupy czekają." };
  } else if (eventRoll < 0.2) {
    specialCard = { n: "Mroczny Ołtarz", i: "💀", type: "EVENT", desc: "Poświęcenie za potęgę." };
  } else {
    // ✅ wybierz playlistę, ale NIE taką jak już w shuffled
    const remaining = ALL_PATHS.filter(p => !pickedIds.has(p.id));
    specialCard = remaining.sort(() => 0.5 - Math.random())[0];

    // awaryjnie, gdyby ALL_PATHS miało <3 elementy
    if (!specialCard) specialCard = shuffled[0];
  }

  // Render 3 kart
  [...shuffled, specialCard].forEach((path, i) => {
    const card = document.createElement("div");
 card.className = "path-card" + (path.type === "EVENT" ? " is-event" : "");
    card.style.animationDelay = `${i * 0.15}s`;

    card.addEventListener("click", () => {
  console.log("KLIK:", path);
  console.log("ID:", path.id, "TYPE:", path.type);

  if (path.type === "EVENT") {
    triggerEvent(path.n);
  } else {
    startGame(path.id);
  }
});

    // Jeśli chcesz rarity na kafelku, zostaw <div class="path-rarity">...</div>
    // Jeśli nie chcesz, usuń tę jedną linię.
card.innerHTML = `
  <div class="path-ornament" aria-hidden="true">✦</div>

  <div class="path-head">
    <div class="path-icon">${path.i}</div>
    <div class="path-title">${path.n}</div>
  </div>

  <div class="path-desc">${path.desc || "Nieznany szlak."}</div>

  <div class="path-route" aria-hidden="true">
    <span class="dot"></span><span class="line"></span><span class="dot"></span>
  </div>

  <div class="path-foot">
    <span class="path-hint">${path.type === "EVENT" ? "Zdarzenie" : "Podróż"}</span>
    <span class="path-arrow">Wyrusz ↗</span>
  </div>
`;
    container.appendChild(card);
  });

  
}



function startFromMenu() {
  // jeśli mamy zapisaną klasę -> idziemy dalej
  if (stats.playerClass) {
    showScreen("selectScreen");
    generatePaths();
    updateRPG();
  } else {
    showScreen("classScreen");
  }
}


function openClassSelectFromMenu() {
  showScreen("classScreen");
}

function continueFromMenu() {
  // Kontynuuj sensownie tylko jeśli klasa jest ustawiona
  if (stats.playerClass) {
    showScreen("selectScreen");
    generatePaths();
    updateRPG();
  } else {
    showScreen("classScreen");
  }
}

if (localStorage.getItem("questly_volume") === null) {
  localStorage.setItem("questly_volume", "100");
}

function selectPath(pId) {
    currentPath = pId;
    
    // Ukrywamy ekran wyboru i pokazujemy ekran gry
    document.getElementById('selectScreen').classList.add('hidden');
    document.getElementById('gameScreen').classList.remove('hidden');
    
    // Odświeżamy HUD i generujemy pytanie
    updateRPG();
    generateQuestion();
}
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playTone(freq, type, duration) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

const sfx = {
    success: () => { playTone(600, 'sine', 0.2); setTimeout(() => playTone(800, 'sine', 0.3), 100); },
    error: () => { playTone(200, 'sawtooth', 0.4); },
    loot: () => { playTone(1000, 'square', 0.1); playTone(1200, 'square', 0.1); }
};

const API_KEY = "AIzaSyDf7uSn81eLjdaAM3GPSwuS__Wl7mtbjhM";
let stats = JSON.parse(localStorage.getItem('questly_v77')) || {
    points: 0,
    xp: 0,
    lvl: 1,
    hearts: 5,
    streak: 0,
    currentStage: 1,
    guessedSongIds: [],
    guessHistory: {
        1: 0, 2: 0, 3: 0, 4: 0, 5: 0
    },
    playerClass: null,
    inventory: { initials: 0, artist: 0, time: 0, '5titles': 0 },
    activeBounty: null,
    bountyProgress: 0,
    songsToday: 0
    
};
let currentQuestionAttempts = 1;
let player, songs = [], currentSong, attemptInRound = 1, startPos = 0, apiReady = false, timeMultiplier = 1;

// === SUPABASE ===


async function authSignOut(){
  // 1) natychmiast pokaż efekt w UI
  cloudUser = null;
  refreshCloudLabel();
  document.getElementById("accountOverlay") && (document.getElementById("accountOverlay").style.display = "none");

  // 2) wyloguj z Supabase (LOCAL wystarczy dla przeglądarki)
  const { error } = await supa.auth.signOut({ scope: "local" });
  if (error) {
    // jeśli jednak błąd, przywróć UI (żeby nie było “ghost logout”)
    const { data } = await supa.auth.getSession();
    cloudUser = data?.session?.user || null;
    refreshCloudLabel();
    alert("Błąd wylogowania: " + error.message);
    return;
  }

  // 3) (opcjonalnie) zapis do chmury TYLKO gdy jesteś zalogowany
  // cloudPush po signOut nie ma sensu, więc tego nie rób tutaj
}

function refreshCloudLabel(){
  const badge = document.getElementById("accountBadge");
  const out = document.getElementById("accountLoggedOut");
  const inn = document.getElementById("accountLoggedIn");
  const em = document.getElementById("accountEmail");
  // uzupełnij dodatkowe pola panelu konta
const nickEl = document.getElementById("accountNick");
if (nickEl) nickEl.textContent = cloudUser?.user_metadata?.nick || cloudUser?.email?.split("@")[0] || "—";

const uidEl = document.getElementById("accountUid");
if (uidEl) uidEl.textContent = cloudUser?.id || "—";
  if (!badge || !out || !inn) return;

  if (cloudUser) {
    badge.textContent = "Chmura ✅";
    out.style.display = "none";
    inn.style.display = "block";
    if (em) em.textContent = cloudUser.email || "(bez email)";
  } else {
    badge.textContent = "Gość";
    out.style.display = "block";
    inn.style.display = "none";
    if (em) em.textContent = "";
  }
}




function onYouTubeIframeAPIReady() {
    player = new YT.Player('ytPlayer', {
        height: '0', width: '0',
        events: { 
            'onReady': () => { 
  apiReady = true; 
  window.player = player;   // ✅ to naprawia suwak/przycisk
},
            'onStateChange': (e) => {
  if (e.data === YT.PlayerState.PLAYING) {
    handleProgressBar();
  }
},
            'onError': onPlayerError // To obsłuży prywatne wideo
        }
    });
}

let loadingTimeout; // Zmienna globalna na timer

function hasPerk(perkKey){
  try { ensureMeta(); } catch(e) { return false; }
  return !!meta?.unlocked?.[perkKey];
}

function exitToMenu() {
  // zakończ run logicznie
  stats.inRun = false;

  // NIE resetujemy stats/meta
  // NIE czyścimy localStorage
  // NIE reloadujemy strony

  // schowaj ekrany runa
  document.getElementById("gameScreen").style.display = "none";
  document.getElementById("runUI").style.display = "none";

  // pokaż menu główne
  document.getElementById("menuScreen").style.display = "flex";

  // jeśli masz overlaye / modale – zamknij
  document
  .querySelectorAll(".event-overlay:not(#accountOverlay)")
  .forEach(el => el?.remove?.());

  // kosmetyka
  updateRPG?.();
}



function onPlayerStateChange(event) {
    // Czyścimy stary timeout przy każdej zmianie stanu
    clearTimeout(loadingTimeout);

    if (event.data == YT.PlayerState.PLAYING) {
        console.log("Piosenka ruszyła pomyślnie!");
        // Tutaj opcjonalnie: hideLoadingSpinner();
    }

    if (event.data == YT.PlayerState.BUFFERING) {
        // Jeśli buforowanie trwa dłużej niż 5 sekund, skipujemy
        loadingTimeout = setTimeout(() => {
            console.warn("Błąd ładowania: Skipowanie niedostępnego utworu.");
            handleVideoError();
        }, 5000); 
    }
}

// Funkcja obsługująca błąd lub brak ładowania
function handleVideoError() {
  showFloatingText("⚠️ PROBLEM Z UTWOREM - SZUKAM NOWEGO...", "var(--error)");

  // usuń aktualny z listy, żeby nie wrócił
  if (currentSong?.id) {
    songs = songs.filter(s => s.id !== currentSong.id);
  }

  // jeśli jesteśmy w grze – ładuj kolejną rundę, inaczej odśwież mapę
  if (document.getElementById('gameScreen')?.classList.contains('hidden')) {
    generatePaths?.();
  } else {
    setRoundLocked(true);
    setTimeout(() => loadRound(), 200);
  }
}



function onPlayerError(e) {
    console.warn("Wykryto niedostępne wideo (Kod błędu: " + e.data + "). Losuję kolejny utwór...");
    
    // Wizualna informacja dla gracza
    showFloatingText("🚫 UTWÓR NIEDOSTĘPNY", "var(--muted)");
    
    // Usuwamy wadliwy utwór z aktualnej listy piosenek, żeby nie wylosować go ponownie
    songs = songs.filter(s => s.id !== currentSong.id);
    
    // Jeśli wciąż mamy piosenki na liście, ładujemy nową rundę
    if (songs.length > 0) {
        setTimeout(loadRound, 500);
    } else {
        alert("Błąd: Brak dostępnych utworów na tej playliście.");
        exitToMenu();
    }
}

function renderPerkPanel(){
  const cont = document.getElementById("perksContainer");
  if (!cont) return;

  if (!stats.playerClass || !CLASSES?.[stats.playerClass]) {
    cont.innerHTML = `<div style="opacity:.7;font-size:.85rem;">Wybierz klasę, aby zobaczyć perki.</div>`;
    return;
  }

  ensureMeta();

  const cls = CLASSES[stats.playerClass];
  const perks = cls.perks || [];

  const classNodes = (TREES?.class?.nodes || []);
  const getNode = (id) => classNodes.find(n => n.id === id);

  const getCost = (id) => {
    const n = getNode(id);
    if (!n) return null;
    if (typeof nodeCost === "function") return nodeCost(n);
    if (typeof n.cost === "function") return n.cost();
    return null;
  };

  const owned = [];
  const toBuy = [];

  for (const p of perks) {
    const ok = !!p.nodeId && !!meta.unlocked?.[p.nodeId];
    (ok ? owned : toBuy).push(p);
  }

  const section = (title, arr, variant) => {
    if (!arr.length) return "";
    const sub = (variant === "owned")
      ? `<span style="opacity:.65;">(działa w każdej grze)</span>`
      : `<span style="opacity:.65;">(kup w drzewku za BANK)</span>`;

    return `
      <div style="margin-top:10px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
          <div style="font-size:.7rem;letter-spacing:2px;color:var(--gold);font-weight:900;">${title}</div>
          <div style="font-size:.75rem;">${sub}</div>
        </div>

        ${arr.map(p => {
          const isOwned = variant === "owned";
          const cost = isOwned ? null : getCost(p.nodeId);

          const bg = isOwned ? "rgba(74,222,128,0.08)" : "rgba(255,255,255,0.03)";
          const br = isOwned ? "rgba(74,222,128,0.22)" : "rgba(255,255,255,0.10)";
          const right = isOwned
            ? `<span style="color:var(--success);font-weight:900;">✅ KUPIONE</span>`
            : `<span style="color:var(--gold);font-weight:900;">💰 ${cost ?? "?"}</span>`;

          return `
            <div class="perk-row" data-node-id="${p.nodeId}" style="background:${bg};border-color:${br}">
              <div class="perk-left">
                <div class="perk-ic">${p.icon || "✨"}</div>
                <div>
                  <div class="perk-name" style="display:flex;gap:8px;align-items:center;">
                    <span>${p.name}</span>
                  </div>
                  <div class="perk-desc">${p.desc || ""}</div>
                </div>
              </div>
              <div class="perk-meta" style="min-width:90px;text-align:right;">
                <div class="perk-lvl" style="font-size:.8rem;">${right}</div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  };

  cont.innerHTML = `
    <div style="font-size:.75rem;letter-spacing:2px;color:var(--gold);font-weight:900;margin-bottom:6px;">
      ${cls.icon} ${cls.name} — PERKI KLASOWE
    </div>

    ${section("AKTYWNE", owned, "owned")}
    ${section("DO KUPIENIA", toBuy, "buy")}

    <button class="btn ghost" style="width:100%; margin-top:10px;"
            onclick="openSkillTrees('sidebar'); switchTreeTab('class');">
      ⚔️ Otwórz drzewko perków
    </button>
  `;
}



function perkId(perk) {
  // stabilne id z nazwy, żeby trzymać w stats.perks
  return perk.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function procPerk(perkName, effect) {
  // 1) highlight perka w panelu
  const id = perkId({ name: perkName });
  const row = document.querySelector(`.perk-row[data-perk-id="${id}"]`);
  if (row) {
    row.classList.remove("perk-proc");
    void row.offsetWidth; // restart animacji
    row.classList.add("perk-proc");
  }

  // 2) HUD efekt (opcjonalnie)
  if (effect) addHudEffect(effect);
}

const hudEffects = new Map(); // key -> { el, timeout }

function addHudEffect({ key, icon, label, ms = 1500 }) {
    const cont = document.getElementById("effectHud");
  if (!cont) return;

  const persistent = ms === 0;

  // jeśli już istnieje – odśwież timer
  if (hudEffects.has(key)) {
    const prev = hudEffects.get(key);
    clearTimeout(prev.timeout);
    prev.el.querySelector(".effect-timer").textContent = Math.ceil(ms/1000) + "s";
    prev.timeout = setTimeout(() => removeHudEffect(key), ms);
    return;
  }

  const el = document.createElement("div");
  el.className = "effect-chip";
  el.innerHTML = `
    <span class="effect-ic">${icon}</span>
    <span class="effect-label">${label}</span>
    <span class="effect-timer">${Math.ceil(ms/1000)}s</span>
  `;
  cont.appendChild(el);

  let timeout = null;
if (!persistent) {
  timeout = setTimeout(() => removeHudEffect(key), ms);
}
hudEffects.set(key, { el, timeout });

  // proste odliczanie (co 1s)
  let left = Math.ceil(ms/1000);
  const tick = setInterval(() => {
    if (!hudEffects.has(key)) return clearInterval(tick);
    left--;
    const t = hudEffects.get(key)?.el?.querySelector(".effect-timer");
    if (t) t.textContent = Math.max(0,left) + "s";
    if (left <= 0) clearInterval(tick);
  }, 1000);
}

function removeHudEffect(key) {
  const it = hudEffects.get(key);
  if (!it) return;
  clearTimeout(it.timeout);
  try { it.el.remove(); } catch(e) {}
  hudEffects.delete(key);
}

function updateRPG() {
    let nextXP = stats.lvl * 1000;
    const nextLevelXP = stats.lvl * 1000;
    const xpPercent = (stats.xp / nextLevelXP) * 100;
    const stageDisplay = document.getElementById('currentStage');
    if (stageDisplay) {
        stageDisplay.innerText = stats.currentStage || 1;
    }
    const xpFill = document.getElementById('xpFill');
    const xpText = document.getElementById('xpText');

    if (xpFill) xpFill.style.width = xpPercent + "%";
    if (xpText) xpText.innerText = Math.floor(xpPercent) + "%";
    if (lvlBadge) lvlBadge.innerText = "LVL " + stats.lvl;
    while (stats.xp >= nextXP) {
  const fromLvl = stats.lvl;

  stats.xp -= nextXP;
  stats.lvl++;

  // nagroda za level-up
  const heartsBefore = stats.hearts;
  stats.hearts = Math.max(stats.hearts + 1, 5);
  const gainedHearts = stats.hearts - heartsBefore;


  // odśwież panel perków, żeby od razu było widać zmiany
  renderPerkPanel?.();

  // zbiorczy komunikat
  showLevelUpNotice({
    fromLvl,
    toLvl: stats.lvl,
    gainedHearts: Math.max(1, gainedHearts), // gdyby heartsBefore było <5
  });

  // update progu dla kolejnego levela (ważne przy wielu level-upach naraz)
  nextXP = stats.lvl * 1000;
}


    const vignette = document.getElementById('vignette');
    if (stats.hearts <= 1) {
        vignette.classList.add('low-hp-active');
    } else {
        vignette.classList.remove('low-hp-active');
    }

    // Tryb Fever (Gorączka) przy serii powyżej 5
    if (stats.streak >= 5) {
        document.body.classList.add('fever-mode');
        // Możesz dodać dodatkowy napis jeśli chcesz
        if (stats.streak === 5) showFloatingText("🔥 FEVER MODE ACTIVE!", "var(--gold)");
    } else {
        document.body.classList.remove('fever-mode');
    }
    document.getElementById('xpFill').style.width = Math.min((stats.xp / (stats.lvl * 1000) * 100), 100) + "%";
    document.getElementById('top-score').textContent = `${stats.points.toLocaleString()} `;
    const classSettings = {
    warrior: { name: "Wojownik", icon: "⚔️", color: "#e74c3c" },
    mage: { name: "Mag", icon: "🔮", color: "#9b59b6" },
    rogue: { name: "Łotr", icon: "🗡️", color: "#2ecc71" }
};

if (stats.playerClass && classSettings[stats.playerClass]) {
    const config = classSettings[stats.playerClass];
    const nameEl = document.getElementById('selectedClassName');
    const iconEl = document.getElementById('heroIcon');
    const indicator = document.getElementById('classIndicator');

    if (iconEl) {
        iconEl.textContent = config.icon;
        iconEl.style.borderColor = config.color;
    }
    if (indicator) indicator.style.borderLeftColor = config.color;
}
    const hBox = document.getElementById('hearts');
    hBox.innerHTML = "";
    let red = Math.min(stats.hearts, 5);
    for(let i=0; i<red; i++) hBox.innerHTML += "❤️";
    for(let i=red; i<5; i++) hBox.innerHTML += "🖤";
    if(stats.hearts > 5) for(let i=0; i<(stats.hearts-5); i++) hBox.innerHTML += '💙';

    for (let item in stats.inventory) {
        const el = document.getElementById(`count-${item}`);
        if(el) {
            el.textContent = stats.inventory[item];
            el.parentElement.disabled = stats.inventory[item] <= 0;
            el.parentElement.style.opacity = stats.inventory[item] <= 0 ? "0.2" : "1";
        }
    }
    const pathsEl = document.getElementById('pathsCompletedText');
    if (pathsEl) {
        // Jeśli nie masz stats.completedPaths, domyślnie 0
        pathsEl.textContent = stats.completedPaths || 0;
    }
    const bContainer = document.getElementById('bountyUi');
    if (bContainer) {
        if (stats.activeBounty) {
            const b = stats.activeBounty;
            // Przeliczamy procent za każdym razem, gdy updateRPG jest wywołane
            const progressPercent = Math.min((stats.bountyProgress / b.goal) * 100, 100);
            
            bContainer.innerHTML = `
                <div class="bounty-panel" style="padding: 15px; border-radius: 10px; display: flex; align-items: center; gap: 15px;">
                    <div style="font-size: 2rem;">📜</div>
                    <div style="flex-grow: 1; text-align: left;">
                        <div style="font-size: 0.6rem; color: var(--gold); letter-spacing: 1px;">AKTYWNY KONTRAKT</div>
                        <div style="font-size: 0.9rem; font-weight: bold; color: white;">${b.title}</div>
                        <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; margin-top: 8px; overflow: hidden;">
                            <div id="bountyProgressBar" style="width: ${progressPercent}%; height: 100%; background: var(--gold); transition: width 0.4s ease-out;"></div>
                        </div>
                    </div>
                    <div style="font-family: 'Cinzel', serif; color: var(--gold); font-size: 0.8rem; min-width: 40px; text-align: right;">
                        ${stats.bountyProgress}/${b.goal}
                    </div>
                </div>
            `;
        } else {
            // Pusta karta, gdy nie ma zlecenia
            bContainer.innerHTML = `
                <div class="bounty-empty-card" onclick="assignNewBounty()">
                    <span>+ Przyjmij nowe zlecenie</span>
                </div>
            `;
        }
    }
if (stats.hearts <= 0) {
    return; // Przerywamy dalsze rysowanie UI
}
    document.getElementById('sessionStats').innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px;">
        <div style="background:var(--bg); padding:10px; border-radius:12px; text-align:center;">
            <small>SERIA</small><br><b>${stats.streak}</b>
        </div>
        <div style="background:var(--bg); padding:10px; border-radius:12px; text-align:center;">
            <small>DZISIAJ</small><br><b>${stats.songsToday}</b>
        </div>
    </div>
    ${renderGuessStats()}
`;
    renderBountyUI();
    renderPerkPanel();
    checkAchievements();
    localStorage.setItem('questly_v77', JSON.stringify(stats));
}

// Czytaj lokalny stan (u Ciebie jest OK)
function readLocalState(){
  const statsRaw = localStorage.getItem("questly_v77");
  const metaRaw =
    localStorage.getItem(META_KEY) ||
    localStorage.getItem("questly_meta_v1") ||
    localStorage.getItem("questly_meta") ||
    "{}";

  return {
    stats: statsRaw ? JSON.parse(statsRaw) : (stats || {}),
    meta:  metaRaw  ? JSON.parse(metaRaw)  : (window.meta || {})
  };
}


function writeLocalState(newStats, newMeta){
  if (newStats) {
    stats = newStats;
    localStorage.setItem("questly_v77", JSON.stringify(stats));
  }
  if (newMeta) {
    meta = newMeta;
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    window.meta = meta;
  }
}


async function cloudPull() {
  if (!cloudUser) return;

  cloudSyncLocked = true;
  try {
    const { data, error } = await supa
      .from("user_saves")
      .select("save, updated_at")
      .eq("user_id", cloudUser.id)
      .maybeSingle();

    if (error) {
      console.warn("cloudPull error:", error.message);
      return;
    }

    // Brak rekordu w chmurze -> nic nie nadpisuj (szczególnie w incognito)
    if (!data || !data.save) {
      console.warn("cloudPull: brak rekordu w user_saves dla", cloudUser.id);
      return;
    }

    const cloudStats = data.save.stats || {};
    const cloudMeta  = data.save.meta  || {};

    const local = readLocalState();

    const mergedMeta =
      (typeof mergeMeta === "function") ? mergeMeta(local.meta, cloudMeta) : (cloudMeta || local.meta);

    const mergedStats =
      (typeof pickBetterStats === "function") ? pickBetterStats(local.stats, cloudStats) : (cloudStats || local.stats);

    try { refreshBankUI?.(); } catch (e) {}
    try { updateRPG?.(); } catch (e) {}

  } finally {
    cloudSyncLocked = false;
  }
}




async function cloudPush(immediate = false) {
  if (cloudSyncLocked) return;

  const userId = await getUserId();
  if (!userId) return;

  const doPush = async () => {
    const payload = {
      stats: stats || {},
      meta: meta || {},
      v: 1
    };

    const { error } = await supa
      .from("user_saves")
      .upsert(
        {
          user_id: userId,
          save: payload
        },
        { onConflict: "user_id" }
      );

    if (error) console.warn("cloudPush error:", error);
  };

  if (immediate) return doPush();

  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(doPush, 2000);
}



function getRectCenter(r) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// Punkt przecięcia promienia (z center recta w stronę targetCenter) z krawędzią recta
function rectEdgePoint(rect, targetCenter) {
  const c = getRectCenter(rect);

  const dx = targetCenter.x - c.x;
  const dy = targetCenter.y - c.y;

  // Jeśli target jest w tym samym punkcie (awaryjnie)
  if (dx === 0 && dy === 0) return { x: c.x, y: c.y };

  // half extents
  const hw = rect.width / 2;
  const hh = rect.height / 2;

  // skalowanie kierunku do przecięcia z bokiem
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);

  let t;
  if (ax / hw > ay / hh) {
    // trafimy w pionowy bok
    t = hw / ax;
  } else {
    // trafimy w poziomy bok
    t = hh / ay;
  }

  return { x: c.x + dx * t, y: c.y + dy * t };
}

async function startGame(pid) {
  // pokaż ekran gry od razu (żeby było widać przejście)
  document.getElementById("selectScreen")?.classList.add("hidden");
  document.getElementById("gameScreen")?.classList.remove("hidden");

  // wymuś inicjalizację YT
  ensureYTPlayer();

  if (!apiReady) {
    showFloatingText("⏳ Ładuję odtwarzacz...", "var(--muted)");
    setTimeout(() => startGame(pid), 250);
    return;
  }

  try {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,status&maxResults=50&playlistId=${pid}&key=${API_KEY}`);
    const d = await r.json();

    if (!d.items || d.items.length === 0) throw new Error("Pusta playlista");

    songs = d.items
      .filter(i => i.status.privacyStatus === 'public' && i.snippet.title !== 'Deleted video')
      .map(i => {
        const raw = i.snippet.title;
        return {
          rawTitle: raw,
          t: raw.replace(/\(.*?\)|\[.*?\]|ft\.*|feat\.*/gi, "").trim(),
          id: i.snippet.resourceId.videoId
        };
      });

// wybierz piosenkę wcześniej i zapamiętaj (bez powtórek)
if (!Array.isArray(stats.guessedSongIds)) stats.guessedSongIds = [];

const availableSongs = songs.filter(s => !stats.guessedSongIds.includes(s.id));

if (availableSongs.length === 0) {
  showFloatingText("🏁 Brak nowych utworów na tej ścieżce", "var(--gold)");
  // wróć na mapę
  document.getElementById('gameScreen')?.classList.add('hidden');
  document.getElementById('selectScreen')?.classList.remove('hidden');
  generatePaths?.();
  return;
}

plannedSong = availableSongs[Math.floor(Math.random() * availableSongs.length)];
currentSong = plannedSong;
stats.currentSongIdForRarity = currentSong.id;

// policz rarity już teraz (żeby było spójne od początku)
// ===== RARITY PER UTWÓR (na podstawie wyświetleń) =====
// Licz tylko jeśli nie mamy już rarity dla tego SAMEGO utworu
const alreadyComputed =
  stats.currentSongIdForRarity === currentSong.id &&
  stats.currentSongRarity &&
  (stats.currentSongViews !== null && stats.currentSongViews !== undefined);

if (!alreadyComputed) {
  stats.currentSongViews = null;
  stats.currentSongRarity = "common";

  try {
    if (typeof fetchVideoStatsCached === "function" && typeof rarityFromViews === "function") {
      const st = await fetchVideoStatsCached(currentSong.id);
      if (st && st.viewCount) {
        stats.currentSongViews = Number(st.viewCount);
        stats.currentSongRarity = rarityFromViews(st.viewCount);
      }
    } else {
      const r = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${currentSong.id}&key=${API_KEY}`
      );
      const d = await r.json();
      const vc = d.items?.[0]?.statistics?.viewCount;

      if (vc) {
        const viewsNum = Number(vc);
        stats.currentSongViews = viewsNum;
        stats.currentSongRarity = rarityFromViews(viewsNum);
      }
    }

    stats.currentSongIdForRarity = currentSong.id;
  } catch (e) {
    console.warn("Rarity: nie udało się pobrać statystyk wideo:", e);
    stats.currentSongViews = null;
    stats.currentSongRarity = "common";
    stats.currentSongIdForRarity = currentSong.id; // żeby nie próbowało w kółko przy tym samym utworze
  }
}

// UI
if (typeof renderSongRarityUI === "function") renderSongRarityUI();


// pokaż na UI od razu
if (typeof renderSongRarityUI === "function") renderSongRarityUI();

// start rundy (bez ponownego losowania)
loadRound();

  } catch (e) {
    console.error("Błąd ładowania ścieżki:", e);
    alert("Ta kraina jest chwilowo niedostępna. Wybierz inną drogę.");
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('selectScreen').classList.remove('hidden');
    generatePaths();
  }
}

// ===== RARITY PER UTWÓR (na podstawie wyświetleń) =====
const SONG_RARITY = {
  legendary: { name: "LEGENDARNE", icon: "🟡", pointsMult: 2.2, xpMult: 1.6 },
  epic:      { name: "EPICKIE",    icon: "🟣", pointsMult: 1.6, xpMult: 1.3 },
  rare:      { name: "RZADKIE",    icon: "🔵", pointsMult: 1.25, xpMult: 1.15 },
  common:    { name: "POSPOLITE",  icon: "⚪", pointsMult: 1.0, xpMult: 1.0 },
};

// Progi możesz zmienić jak chcesz:
function rarityFromViews(viewCount) {
  const v = Number(viewCount || 0);

  // im MNIEJ wyświetleń, tym WYŻSZE rarity (trudniej)
  if (v <= 500_000)     return "legendary";
  if (v <= 5_000_000)   return "epic";
  if (v <= 50_000_000)  return "rare";
  return "common";
}

// Cache w pamięci (żeby nie marnować quota)
const videoStatsCache = new Map(); // videoId -> statistics

async function fetchVideoStatsCached(videoId) {
  if (!videoId) return null;
  if (videoStatsCache.has(videoId)) return videoStatsCache.get(videoId);

  try {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}&key=${API_KEY}`
    );
    const d = await r.json();
    const stats = d.items?.[0]?.statistics || null;
    videoStatsCache.set(videoId, stats);
    return stats;
  } catch (e) {
    console.warn("fetchVideoStatsCached error:", e);
    videoStatsCache.set(videoId, null);
    return null;
  }
}

// UI (opcjonalne): pokazuje rarity w statusLabel
function renderSongRarityUI() {
  const el = document.getElementById("statusLabel");
  if (!el) return;

  const key = stats.currentSongRarity || "common";
  const R = SONG_RARITY[key] || SONG_RARITY.common;

  const views = stats.currentSongViews
    ? ` • 👁️ ${Number(stats.currentSongViews).toLocaleString("pl-PL")}`
    : "";

  el.textContent = `${R.icon} ${R.name}${views}`;
}

async function loadRound() {
  // 1) losujemy utwór
roundStartTs = Date.now();
hintUsedThisRound = false;
attemptInRound = 1;
currentQuestionAttempts = 1;
document.getElementById('heroAttempt').textContent = "Próba 1";
const isGuessed = (s) => s && stats.guessedSongIds.includes(s.id);

// jeśli plannedSong istnieje, ale już była zgadnięta -> ignorujemy ją
if (plannedSong && isGuessed(plannedSong)) {
  plannedSong = null;
}

// budujemy pulę dostępnych (jeszcze niezgadniętych)
const availableSongs = songs.filter(s => !stats.guessedSongIds.includes(s.id));

if (plannedSong) {
  currentSong = plannedSong;
  plannedSong = null; // zużyte
} else {
  if (availableSongs.length === 0) {
    showFloatingText("🏁 Koniec utworów na tej ścieżce", "var(--gold)");

    // wybierz jedno zachowanie:
    // 1) wróć na mapę:
    finishPath?.(); // jeśli chcesz kończyć ścieżkę
    // albo:
    // goToPathSelection(); // jeśli używasz tego przejścia
    // albo:
    // exitToMenu();

    return;
  }

  currentSong = availableSongs[Math.floor(Math.random() * availableSongs.length)];
}

  // 2) reset rundy
  attemptInRound = 1;
  timeMultiplier = 1;

  // 3) UI / HUD
  document.getElementById('heroOverlay').classList.remove('hidden');
  updateHeroOverlay();

  document.getElementById('hintDisplay').textContent = "";
  setupInitialsForSong(currentSong.t);
  document.getElementById('guessInput').value = "";
  setRoundLocked(false);

  // 4) datalist (podpowiedzi tytułów)
  const dl = document.getElementById('hints');
  dl.innerHTML = "";
  songs.forEach(s => {
    const o = document.createElement('option');
    o.value = s.t;
    dl.appendChild(o);
  });

  // 5) reset per-runda
  stats.rewindUsed = false;

  // Wojownik: second_wind — +1❤️ na start rundy (jak u Ciebie)
  if (hasPerk("second_wind")) {
    stats.hearts += 1;
  }

  // ===== RARITY PER UTWÓR (na podstawie wyświetleń) =====
  // fallback jeśli coś pójdzie nie tak
  stats.currentSongViews = null;
  stats.currentSongRarity = "common";

  try {
    // Jeśli masz wcześniej cache/helper, użyj go
    if (typeof fetchVideoStatsCached === "function" && typeof rarityFromViews === "function") {
      const st = await fetchVideoStatsCached(currentSong.id);
      if (st && st.viewCount) {
        stats.currentSongViews = Number(st.viewCount);
        stats.currentSongRarity = rarityFromViews(st.viewCount);
      }
    } else {
      // Wersja samowystarczalna (bez helperów)
      const r = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${currentSong.id}&key=${API_KEY}`
      );
      const d = await r.json();
      const vc = d.items?.[0]?.statistics?.viewCount;

      if (vc) {
        const viewsNum = Number(vc);
        stats.currentSongViews = viewsNum;

        // Progi możesz zmienić jak chcesz:
        if (viewsNum >= 300000000) stats.currentSongRarity = "legendary";
        else if (viewsNum >= 50000000) stats.currentSongRarity = "epic";
        else if (viewsNum >= 5000000) stats.currentSongRarity = "rare";
        else stats.currentSongRarity = "common";
      }
    }
  } catch (e) {
    console.warn("Rarity: nie udało się pobrać statystyk wideo:", e);
    stats.currentSongViews = null;
    stats.currentSongRarity = "common";
  }

  // (Opcjonalnie) pokaż rarity w statusLabel bez rozwalania UI
  // Jeśli masz renderSongRarityUI() wcześniej — użyj
  if (typeof renderSongRarityUI === "function") {
    renderSongRarityUI();
  } else {
    const el = document.getElementById("statusLabel");
    if (el) {
      const map = {
        legendary: "🟡 LEGENDARNE",
        epic: "🟣 EPICKIE",
        rare: "🔵 RZADKIE",
        common: "⚪ POSPOLITE"
      };
      const rarityLabel = map[stats.currentSongRarity] || map.common;
      const viewsTxt = stats.currentSongViews
        ? ` • 👁️ ${Number(stats.currentSongViews).toLocaleString("pl-PL")}`
        : "";
      el.textContent = `${rarityLabel}${viewsTxt}`;
    }
  }

  // 6) start muzyki
  playCurrent();
}

function playCurrent(isReplay = false) {
  window.lastPlayWasReplay = !!isReplay;
    if(!isReplay) startPos = Math.floor(Math.random() * 60) + 20;
    const fill = document.getElementById('progressFill');
    fill.style.transition = 'none';
    fill.style.width = "0%";
    player.loadVideoById({ videoId: currentSong.id, startSeconds: startPos });
    setTimeout(enforceVolume, 200);
setTimeout(enforceVolume, 800);
}

function setupInitialsForSong(title) {
  const clean = (title || "")
    .toUpperCase()
    .replace(/[^A-ZĄĆĘŁŃÓŚŻŹ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // bierzemy unikalne litery (bez spacji), zachowując kolejność wystąpień
  const letters = clean.replace(/ /g, "").split("");
  initialsPool = [...new Set(letters)];
  initialsRevealed = [];
}

(async () => {
  const ok = await supaHealthcheck();
  if (!ok) {
    alert(
      "⚠️ Wykryto blokadę połączenia z chmurą.\n\n" +
      "Wyłącz AdBlock / Brave Shields dla tej strony,\n" +
      "inaczej zapis i logowanie nie będą działać."
    );
  }
})();

function handleProgressBar() {
  const fill = document.getElementById('progressFill');
  if (!fill) return;

  let dur = (attemptInRound > 1 ? 4 : 2) * timeMultiplier;

  // Mag: Resonance — +0.5s do audio
  if (hasPerk("perk_m_resonance")) dur += 0.5;

  // Wojownik: Momentum — seria ≥3 wydłuża audio
  if (hasPerk("perk_w_momentum") && (stats.streak || 0) >= 3) dur *= 1.5;

  fill.style.transition = 'none';
  fill.style.width = "0%";

  setTimeout(() => {
    fill.style.transition = `width ${dur}s linear`;
    fill.style.width = "100%";
  }, 50);

  setTimeout(() => {
    try { player?.pauseVideo?.(); } catch(e) {}
  }, dur * 1000);
}

function checkGuess() {
  if (roundLocked) return;

  if (stats.guessedSongIds.includes(currentSong.id)) {
    console.warn("Ta piosenka była już zaliczona – ignoruję.");
    return;
  }

  const inputEl = document.getElementById('guessInput');
  const val = (inputEl?.value || "").toLowerCase().trim();
  if (!val) return;

  const gameCard = document.querySelector('.game-card');

  // --- LOGIKA TRAFIENIA ---
  if (isCorrectGuess(val, currentSong.t)) {
    const attemptKey = attemptInRound >= 5 ? 5 : attemptInRound;
    stats.guessHistory[attemptKey] = (stats.guessHistory[attemptKey] || 0) + 1;

    stats.guessedSongIds.push(currentSong.id);

    let pointsGain = 500;
    let xpGain = 250;
    let bonusLabel = "";

    checkBountyProgress("CORRECT", {
      attempt: attemptInRound,
      timeMs: Date.now() - (roundStartTs || Date.now()),
      usedHint: !!hintUsedThisRound,
    });

    document.getElementById('heroOverlay')?.classList.add('hidden');

    // --- PERKI Z DRZEWKA ---
    if (hasPerk("perk_r_first") && attemptInRound === 1) {
      procPerk("Pierwsza Krew", { key:"perk_r_first", icon:"🎯", label:"+PKT/+XP (1. próba)", ms:1200 });
      pointsGain = Math.floor(pointsGain * 1.25);
      xpGain = Math.floor(xpGain * 1.15);
    }

    if (hasPerk("perk_r_crit") && Math.random() < 0.20) {
      procPerk("Krytyk", { key:"perk_r_crit", icon:"💥", label:"2x Punkty", ms:1200 });
      pointsGain *= 2;
      bonusLabel = "KRYTYK! ";
    }

    if (hasPerk("perk_w_momentum") && (stats.streak || 0) >= 3) {
      procPerk("Momentum", { key:"perk_w_momentum", icon:"🔥", label:"+15% XP/PKT (streak≥3)", ms:1200 });
      pointsGain = Math.floor(pointsGain * 1.15);
      xpGain = Math.floor(xpGain * 1.15);
    }

    if (hasPerk("perk_m_focus") && window.hintUsedThisRound) {
      procPerk("Skupienie", { key:"perk_m_focus", icon:"🧠", label:"+10% XP (po hincie)", ms:1200 });
      xpGain = Math.floor(xpGain * 1.10);
    }

    // 2) Fever
    if (stats.streak >= 5) {
      addHudEffect({ key:"fever", icon:"🔥", label:"Fever x1.5", ms:0 });
      pointsGain = Math.floor(pointsGain * 1.5);
      xpGain = Math.floor(xpGain * 1.5);
    }

    // 3) Rarity multipliers
    const rk = stats.currentSongRarity || "common";
    const RR = SONG_RARITY[rk] || SONG_RARITY.common;
    pointsGain = Math.floor(pointsGain * RR.pointsMult);
    xpGain = Math.floor(xpGain * RR.xpMult);

    // RUN
    stats.points += pointsGain;
    stats.xp += xpGain;
    stats.streak++;
    stats.currentStage++;

    runCorrect++;
    runBestStreak = Math.max(runBestStreak, stats.streak);

    // BANK
    ensureMeta();
    let bankRate = 0.10;
    if (meta.unlocked?.bank_interest) bankRate += 0.02;
    const bankGain = Math.floor(pointsGain * bankRate);
    meta.bank += bankGain;
    saveMeta();
    refreshBankUI();
    cloudPush(false);

    runBankGained += bankGain;


    stats.totalCorrect = (stats.totalCorrect || 0) + 1;
    stats.songsToday++;
    stats.completedPaths = (stats.completedPaths || 0) + 1;

    updateRPG();

    // SFX
    sfx.success();
    showFloatingText(`${bonusLabel}${RR.icon} ${RR.name} +${pointsGain} PKT`, "var(--success)");

    // DROP
    let dropLabel = "Brak";
    let dropChance = stats.playerClass === 'rogue' ? 0.20 : 0.10;

    if (Math.random() < dropChance) {
      const roll = Math.random();
      const drop =
        roll > 0.9 ? '5titles' :
        roll > 0.7 ? 'time' :
        roll > 0.4 ? 'artist' :
        'initials';

      stats.inventory[drop]++;
      dropLabel = drop.toUpperCase();
      sfx.loot();
    }

    updateRPG();

    // OKNO SUKCESU
    const ov = document.createElement("div");
    ov.style.cssText = `
      position:fixed; inset:0; z-index:6500;
      background:rgba(0,0,0,0.72);
      display:flex; align-items:center; justify-content:center;
    `;

    ov.innerHTML = `
      <div style="
        width:min(560px, 92vw);
        padding:22px 20px;
        border-radius:18px;
        border:2px solid var(--gold);
        background:linear-gradient(135deg, rgba(26,26,46,0.95), rgba(22,33,62,0.95));
        box-shadow:0 30px 80px rgba(0,0,0,0.6);
        text-align:center;">

        <div style="font-size:2.2rem; margin-bottom:6px;">✅</div>
        <div style="font-weight:900; letter-spacing:2px; color:var(--gold); font-family:'Cinzel',serif;">
          TRAFIONE!
        </div>

        <div style="margin-top:8px; opacity:0.9; font-size:0.95rem;">
          Próba: <b>${attemptInRound}</b>
        </div>

        <div style="margin-top:14px; display:grid; gap:10px; font-size:1.05rem;">
          <div>💰 <b>+${pointsGain}</b> PKT</div>
          <div>✨ <b>+${xpGain}</b> XP</div>
          <div>🎁 Drop: <b>${dropLabel}</b></div>
        </div>

        <button id="guessOkBtn" style="
          margin-top:16px; width:100%;
          padding:12px 12px;
          border-radius:14px;
          border:none;
          background:var(--gold);
          color:#000; font-weight:900; cursor:pointer;">
          KONTYNUUJ
        </button>
      </div>
    `;

    document.body.appendChild(ov);

    const nextAction = () => {
      try { ov.remove(); } catch(e) {}
      if (player && player.pauseVideo) player.pauseVideo();
      document.getElementById('gameScreen')?.classList.add('hidden');
      document.getElementById('selectScreen')?.classList.remove('hidden');
      generatePaths();
    };

    ov.querySelector("#guessOkBtn")?.addEventListener("click", nextAction);
    ov.addEventListener("click", (e) => { if (e.target === ov) nextAction(); });

  } else {
    // --- LOGIKA BŁĘDU ---
    let shouldLoseHeart = true;
    removeHudEffect("fever");

    stats.mistakesTotal = (stats.mistakesTotal || 0) + 1;
    checkBountyProgress("WRONG", { attempt: attemptInRound });

    // (UWAGA: tu masz jeszcze stare id perków — to tylko składnia/klamry naprawiamy)

    let heartPenalty = 1;
    


    if (
  stats.playerClass === "warrior" &&
  hasPerk("perk_w_unbreak") &&
  (stats.hearts || 0) <= 1 &&
  !runUnbreakUsed
) {
  runUnbreakUsed = true;          // ✅ tylko raz na run
  shouldLoseHeart = false;        // blokuj tylko tę jedną pomyłkę
  showFloatingText("💢 UNBREAKABLE!", "var(--armor)");
}

    if (shouldLoseHeart) {
  const lost = window.loseHeart(heartPenalty);
  if (lost > 0) showFloatingText(``, "var(--error)");
    }
    let skipStreakReset = false;
if (stats.playerClass === "rogue" && hasPerk("perk_r_shadow") && !stats._shadowUsed) {
  stats._shadowUsed = true;      // 1x/run
  skipStreakReset = true;
}

if (!skipStreakReset) {
  stats.streak = 0;
}

    setTimeout(() => {
      const heartEls = document.querySelectorAll('#heroHearts .heart.full');
      const lastHeart = heartEls[heartEls.length - 1];
      if (lastHeart) lastHeart.classList.add('break');
      setTimeout(() => updateHeroOverlay(), 350);
    }, 50);

    const heroCard = document.querySelector('.hero-card');
    if (heroCard) {
      heroCard.classList.remove('shake');
      void heroCard.offsetWidth;
      heroCard.classList.add('shake');
    }

    updateHeroOverlay();
    attemptInRound++;

    let xpPenalty = stats.playerClass === 'warrior' ? 50 : 100;
    stats.xp = Math.max(0, stats.xp - xpPenalty);

    sfx.error();
    showFloatingText("💥 BŁĄD! -1❤️", "var(--error)");

    if (gameCard) {
      gameCard.classList.add('shake');
      setTimeout(() => gameCard.classList.remove('shake'), 400);
    }

    // ✅ ZAMIANA: zamiast błędnego "else" po if(gameCard)
    updateRPG();
    playCurrent(true);
  }

  // Czyszczenie pola wpisywania
  if (inputEl) inputEl.value = "";
}



const HINT_INFO = {
  initials: {
    icon: "🔡",
    title: "Litery",
    desc: "Pokazuje inicjały słów z tytułu (np. H... O... F...)."
  },
  artist: {
    icon: "👤",
    title: "Wykonawca",
    desc: "Pokazuje wykonawcę (część przed myślnikiem w tytule YouTube)."
  },
  time: {
    icon: "⏳",
    title: "Czas x3",
    desc: "Wydłuża odsłuch (mnożnik czasu x3 na ten utwór)."
  },
  "5titles": {
    icon: "🎯",
    title: "5 opcji",
    desc: "Daje 5 możliwych tytułów do wyboru (podpowiedzi w liście)."
  }
};

// ===== META: BANK + ULEPSZENIA (PERMA) =====
const META_KEY = "questly_meta_v2";

let meta = JSON.parse(localStorage.getItem(META_KEY)) || {
  bank: 0,
  upgrades: {},     // trzymamy poziomy node'ów
  unlocked: {}      // czy node kupiony (dla node'ów typu "jednorazowo")
};

function closeSkillTrees() {
  const ov = document.getElementById("skillOverlay");
  if (ov) ov.remove();

  // zdejmij handler ESC
  if (window.__skillEscHandler) {
    window.removeEventListener("keydown", window.__skillEscHandler);
    window.__skillEscHandler = null;
  }
}

function saveMeta(){ localStorage.setItem(META_KEY, JSON.stringify(meta)); }
function ensureMeta(){
  if(!meta || typeof meta !== "object") meta = { bank:0, upgrades:{}, unlocked:{} };
  meta.bank ??= 0;
  meta.upgrades ??= {};
  meta.unlocked ??= {};
  saveMeta();
  cloudPush(false);
}
ensureMeta();

// ===== TRUDNOŚĆ RUNA =====
const DIFFICULTIES = {
  easy:   { name:"Łatwy",   maxStage:20, mult:1.0 },
  medium: { name:"Średni",  maxStage:30, mult:1.5 },
  hard:   { name:"Trudny",  maxStage:40, mult:2.0 },
};
let selectedDifficulty = localStorage.getItem("questly_diff") || "easy";

function setDifficulty(key){
  if(!DIFFICULTIES[key]) key = "easy";
  selectedDifficulty = key;
  localStorage.setItem("questly_diff", key);
  renderDifficultyInfo();
}

function renderDifficultyInfo(){
  const el = document.getElementById("difficultyInfo");
  if(!el) return;
  const d = DIFFICULTIES[selectedDifficulty] || DIFFICULTIES.easy;
  el.innerHTML = `Wybrano: <b>${d.name}</b> • limit: <b>${d.maxStage} etap</b> • bonus punktów: <b>x${d.mult}</b>`;
}

// odpal przy starcie strony
setTimeout(renderDifficultyInfo, 0);

const TREES = {
  
  aid: {
    title: "Ułatwienia",
    subtitle: "Dłuższe słuchanie, replay, startowe wsparcie",
    nodes: [
      {
        id:"audio_plus",
        icon:"🎧",
        name:"Dłuższy odsłuch",
        desc:"+0.1s do czasu słuchania (każda próba)",
        kind:"level", maxLvl:20,
        cost:(lvl)=> 1200 + lvl*650,
        pos:{x:8,y:12}
      },
      {
        id:"replay_plus",
        icon:"🔄",
        name:"Lepszy replay",
        desc:"+0.1s tylko gdy użyjesz 🔄 replay",
        kind:"level", maxLvl:15,
        req:[{id:"audio_plus", lvl:3}],
        cost:(lvl)=> 1500 + lvl*750,
        pos:{x:38,y:30}
      },
      {
        id:"start_hint",
        icon:"✨",
        name:"Start: 1 bonus hint",
        desc:"+1 losowy item w ekwipunku na start runa",
        kind:"once",
        req:[{id:"audio_plus", lvl:5}],
        cost:()=> 9000,
        pos:{x:68,y:14}
      },
      {
        id:"combo_bonus",
        icon:"🔥",
        name:"Combo bonus",
        desc:"+5% punktów za każdy streak >= 5 (stackuje się do 25%)",
        kind:"once",
        req:[{id:"replay_plus", lvl:5}],
        cost:()=> 14000,
        pos:{x:68,y:44}
      },
    ],
    edges: [
      ["audio_plus","replay_plus"],
      ["audio_plus","start_hint"],
      ["replay_plus","combo_bonus"],
      ["replay_plus","quality_filter"],
      ["audio_plus","quality_filter"],
    ]
  },

  survival: {
    title: "Przeżywalność",
    subtitle: "Serca, tarcze i ratunek, gdy idzie źle",
    nodes: [
      {
        id:"start_hearts",
        icon:"❤️",
        name:"Więcej serc na start",
        desc:"+1❤️ na start runa (max +3)",
        kind:"level", maxLvl:3,
        cost:(lvl)=> 8000 + lvl*9000,
        pos:{x:8,y:18}
      },
      {
        id:"start_shield",
        icon:"🛡️",
        name:"Tarcza na start",
        desc:"Pierwsza pomyłka w runie nie zabiera serca (1x/run)",
        kind:"once",
        req:[{id:"start_hearts", lvl:1}],
        cost:()=> 12000,
        pos:{x:38,y:10}
      },
      {
        id:"dodge_heart",
        icon:"🍀",
        name:"Unik straty serca",
        desc:"10% szansy uniknąć utraty serca (max 30%)",
        kind:"level", maxLvl:3,
        req:[{id:"start_hearts", lvl:2}],
        cost:(lvl)=> 11000 + lvl*12000,
        pos:{x:38,y:42}
      },
      {
        id:"second_wind",
        icon:"💉",
        name:"Second wind",
        desc:"Co 5 etapów: +1❤️ (jeśli masz < max startowych + bonus)",
        kind:"once",
        req:[{id:"dodge_heart", lvl:2}],
        cost:()=> 22000,
        pos:{x:68,y:26}
      },
      {
        id:"bank_interest",
        icon:"💰",
        name:"Premia do banku",
        desc:"+2% do wpływu do banku (zamiast 10% jest 12%)",
        kind:"once",
        req:[{id:"start_shield", lvl:1}],
        cost:()=> 18000,
        pos:{x:8,y:52}
      },
    ],
    edges: [
      ["start_hearts","start_shield"],
      ["start_hearts","dodge_heart"],
      ["dodge_heart","second_wind"],
      ["start_shield","bank_interest"],
      ["start_hearts","bank_interest"],
    ]
  },
  class: {
  title: "Perki klasowe",
  subtitle: "Wojownik / Łotr / Mag — od lewej do prawej",
  nodes: [
    // =========================
    // RZĄD 1 — WOJOWNIK
    // =========================
    { id:"perk_w_thick",    icon:"🛡️", name:"Pancerz",         desc:"Co 3. utrata serca jest anulowana (licznik w runie).", kind:"once", cost:()=>12000, pos:{x:18,y:18} },
    { id:"perk_w_momentum", icon:"🔥", name:"Momentum",        desc:"Streak ≥3: +15% XP i PKT za trafienie.",               kind:"once", cost:()=>18000, pos:{x:45,y:18}, req:[{id:"perk_w_thick", lvl:1}] },
    { id:"perk_w_unbreak",  icon:"💢", name:"Ostatni Bastion", desc:"Gdy masz 1❤️: 1. pomyłka nie zabiera serca (1x/run).", kind:"once", cost:()=>24000, pos:{x:72,y:18}, req:[{id:"perk_w_momentum", lvl:1}] },

    // =========================
    // RZĄD 2 — ŁOTR
    // =========================
    { id:"perk_r_first",  icon:"🎯", name:"Pierwsza Krew", desc:"1. próba: +25% PKT i +15% XP.",             kind:"once", cost:()=>12000, pos:{x:18,y:48} },
    { id:"perk_r_shadow", icon:"👣", name:"Shadow Step",   desc:"Pierwszy błąd w runie nie resetuje serii.",  kind:"once", cost:()=>18000, pos:{x:45,y:48}, req:[{id:"perk_r_first", lvl:1}] },
    { id:"perk_r_crit",   icon:"💥", name:"Krytyk",        desc:"20% szansy na x2 PKT za trafienie.",        kind:"once", cost:()=>24000, pos:{x:72,y:48}, req:[{id:"perk_r_shadow", lvl:1}] },

    // =========================
    // RZĄD 3 — MAG
    // =========================
    { id:"perk_m_resonance", icon:"🔊", name:"Rezonans", desc:"Każda próba: +0.5s audio (w tej rundzie).", kind:"once", cost:()=>12000, pos:{x:18,y:78} },
    { id:"perk_m_arcane",    icon:"✨", name:"Arkana",   desc:"Start runa: +1 losowy hint (1x/run).",      kind:"once", cost:()=>18000, pos:{x:45,y:78}, req:[{id:"perk_m_resonance", lvl:1}] },
    { id:"perk_m_focus",     icon:"🧠", name:"Skupienie",desc:"Po użyciu hintu w rundzie: +10% XP za trafienie.", kind:"once", cost:()=>24000, pos:{x:72,y:78}, req:[{id:"perk_m_arcane", lvl:1}] },
  ],
  edges: [
    // Wojownik → →
    ["perk_w_thick","perk_w_momentum"],
    ["perk_w_momentum","perk_w_unbreak"],

    // Łotr → →
    ["perk_r_first","perk_r_shadow"],
    ["perk_r_shadow","perk_r_crit"],

    // Mag → →
    ["perk_m_resonance","perk_m_arcane"],
    ["perk_m_arcane","perk_m_focus"],
  ]
  }
};

function getNode(treeKey, nodeId){
  return TREES[treeKey].nodes.find(n => n.id === nodeId);
}

function nodeLevel(id){ return meta.upgrades[id] || 0; }
function isUnlocked(id){ return !!meta.unlocked[id]; }

function meetsReq(node){
  const req = node.req || [];
  for (const r of req) {
    const need = (r.lvl || 1);

    const lvlOk = (meta.upgrades?.[r.id] || 0) >= need;
    const onceOk = !!meta.unlocked?.[r.id]; // <- KLUCZ: perki "once"

    if (!lvlOk && !onceOk) return false;
  }
  return true;
}

function nodeCost(node){
  if(node.kind === "once") return node.cost(0);
  return node.cost(nodeLevel(node.id));
}

function canBuy(node){
  if(!meetsReq(node)) return {ok:false, why:"REQ"};
  if(node.kind === "once"){
    if(isUnlocked(node.id)) return {ok:false, why:"MAX"};
  } else {
    if(nodeLevel(node.id) >= node.maxLvl) return {ok:false, why:"MAX"};
  }
  const cost = nodeCost(node);
  if(meta.bank < cost) return {ok:false, why:"BANK", cost};
  return {ok:true, cost};
}

function buyNode(treeKey, nodeId){
  ensureMeta();
  const node = getNode(treeKey, nodeId);
  if(!node) return;

  const chk = canBuy(node);
  if(!chk.ok){
    if(chk.why === "REQ") showFloatingText("🔒 Wymagania nie spełnione", "var(--muted)");
    if(chk.why === "MAX") showFloatingText("✅ Maksymalny poziom / już kupione", "var(--muted)");
    if(chk.why === "BANK") showFloatingText(`❌ Za mało w banku (${meta.bank}/${chk.cost})`, "var(--error)");
    return;
  }

  meta.bank -= chk.cost;

  if(node.kind === "once"){
    meta.unlocked[node.id] = true;
  } else {
    meta.upgrades[node.id] = (meta.upgrades[node.id]||0) + 1;
  }

  saveMeta();
refreshBankUI();     // <- natychmiast licznik banku
renderTreesUI();     // <- odświeża poziomy/stan node’ów
showFloatingText(`${node.icon} ${node.name} ✅`, "var(--success)");
}

// ===== UI DRZEWEK =====
let currentTreeTab = "aid";
let currentTreeContext = "start";

function openSkillTrees(context = "start") {
  // zapamiętaj kontekst (menu / start / run)
  window.skillTreeContext = context;

  // domyślna zakładka
  if (!window.currentTreeTab) {
    window.currentTreeTab = "aid";
  }

  // usuń poprzedni overlay jeśli istnieje
  const old = document.getElementById("skillOverlay");
  if (old) old.remove();

  const ov = document.createElement("div");
  ov.id = "skillOverlay";
  ov.style.cssText = `
    position:fixed;
    inset:0;
    z-index:4000;
    background:rgba(0,0,0,0.88);
    backdrop-filter: blur(6px);
    display:flex;
    align-items:center;
    justify-content:center;
  `;

  ov.innerHTML = `
    <div class="skill-tree-card" style="
      width:min(1100px, 96vw);
      height:min(720px, 92vh);
      background:linear-gradient(135deg,#0f1117,#141827);
      border:2px solid var(--gold);
      border-radius:22px;
      box-shadow:0 30px 80px rgba(0,0,0,.6);
      display:flex;
      flex-direction:column;
      overflow:hidden;
    ">

      <!-- HEADER -->
      <div style="
        display:flex;
        align-items:center;
        justify-content:space-between;
        padding:16px 20px;
        border-bottom:1px solid rgba(255,255,255,0.08);
      ">
        <div>
          <div style="font-size:0.7rem;letter-spacing:2px;color:var(--gold);opacity:.9">
            DRZEWKA ULEPSZEŃ
          </div>
          <div style="font-size:1.2rem;font-weight:900;color:#fff">
            Rozwój bohatera
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:14px">
          <div style="font-size:0.8rem;color:#fff">
            BANK: <b id="bankVal" style="color:var(--gold)">${(meta?.bank ?? 0).toLocaleString("pl-PL")}</b>
          </div>
          <button onclick="closeSkillTrees()" style="
            background:none;
            border:none;
            color:#fff;
            font-size:1.4rem;
            cursor:pointer;
          ">✕</button>
        </div>
      </div>

      <!-- TABS -->
      <div class="skill-tabs" style="
        display:flex;
        gap:8px;
        padding:12px;
        justify-content:center;
        border-bottom:1px solid rgba(255,255,255,0.08);
      ">
        <button class="skill-tab" id="tabAid" onclick="switchTreeTab('aid')">
          🎧 Ułatwienia
        </button>
        <button class="skill-tab" id="tabSurv" onclick="switchTreeTab('survival')">
          ❤️ Przeżywalność
        </button>
        <button class="skill-tab" id="tabClass" onclick="switchTreeTab('class')">
          ⚔️ Perki klasowe
        </button>
      </div>

      <!-- CONTENT -->
<div style="
  position:relative;
  flex:1;
  overflow:visible;
">
  <!-- VIEWPORT (scroll) -->
  <div id="treeViewport" style="
    position:absolute;
    inset:0;
    overflow:auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    background: radial-gradient(circle at 30% 20%, rgba(255,204,0,0.06), transparent 55%);
  ">
    <!-- STAGE (duża plansza) -->
    <div id="treeStage" style="
      position:relative;
      width:1400px;
      height:900px;
      margin:0 auto;
    ">
      <!-- rysujemy linie i nody wewnątrz PADDED CANVAS -->
      <svg id="treeLines" style="
        position:absolute;
        inset:40px;
        width:calc(100% - 80px);
        height:calc(100% - 80px);
        pointer-events:none;
        z-index:2;
      "></svg>

      <div id="treeNodes" style="
        position:absolute;
        inset:40px;
        z-index:1;
      "></div>
    </div>
  </div>
</div>


      <!-- FOOTER -->
      <div style="
        padding:12px 18px;
        border-top:1px solid rgba(255,255,255,0.08);
        font-size:0.75rem;
        color:rgba(255,255,255,0.6);
        display:flex;
        justify-content:space-between;
      ">
        <div>
          Kliknij w węzeł, aby kupić ulepszenie za BANK.
        </div>
        <div>
          Odblokowania są permanentne.
        </div>
      </div>

    </div>
  `;

  document.body.appendChild(ov);

// zamykanie: klik w tło
ov.addEventListener("click", (e) => {
  if (e.target === ov) closeSkillTrees();
});

// zamykanie: ESC
window.__skillEscHandler = (e) => {
  if (e.key === "Escape") closeSkillTrees();
};
window.addEventListener("keydown", window.__skillEscHandler);


  // render aktualnej zakładki
  renderTreesUI();
}


function switchTreeTab(tab){
  currentTreeTab = tab;
  renderTreesUI(currentTreeContext);
}

function renderTreesUI() {
  ensureMeta();

  // bank w headerze
  const bankEl = document.getElementById("bankVal");
  if (bankEl) bankEl.textContent = meta.bank.toLocaleString("pl-PL");

  const t = TREES[currentTreeTab];
  if (!t) return;

  // tytuł / subtitle (jeśli masz w overlay)
  const sub = document.getElementById("treeSubtitle");
  if (sub) sub.textContent = `${t.title} — ${t.subtitle}`;

  // taby
  const tabAid = document.getElementById("tabAid");
  const tabSurv = document.getElementById("tabSurv");
  const tabClass = document.getElementById("tabClass");
  tabAid?.classList.toggle("active", currentTreeTab === "aid");
  tabSurv?.classList.toggle("active", currentTreeTab === "survival");
  tabClass?.classList.toggle("active", currentTreeTab === "class");

  const nodesWrap = document.getElementById("treeNodes");
  const linesSvg = document.getElementById("treeLines");
  const stage = document.getElementById("treeStage");
  if (!nodesWrap || !linesSvg || !stage) return;

  // Czyścimy node'y i linie
  nodesWrap.innerHTML = "";
  linesSvg.innerHTML = "";

  // ===== defs dla strzałek (marker-end) =====
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `
    <marker id="arrow-gold" markerWidth="10" markerHeight="10"
      refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L9,3 z" fill="rgba(255,204,0,0.9)"/>
    </marker>

    <marker id="arrow-gray" markerWidth="10" markerHeight="10"
      refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L9,3 z" fill="rgba(255,255,255,0.25)"/>
    </marker>
  `;
  linesSvg.appendChild(defs);

  // ===== 1) Render node'ów =====
  for (const n of t.nodes) {
    const lvl = nodeLevel(n.id);
    const unlocked = isUnlocked(n.id);

    const chk = canBuy(n);       // { ok, reason, cost }
    const cost = nodeCost(n);    // liczba

    const node = document.createElement("div");
    node.className = "tree-node";
    node.dataset.nodeId = n.id;

    node.style.left = `${n.pos.x}%`;
    node.style.top = `${n.pos.y}%`;

    // stan locked jeśli nie spełnia wymagań
    if (!meetsReq(n)) node.classList.add("locked");

    // maxed
    const maxed =
      (n.kind === "once" && unlocked) ||
      (n.kind === "level" && lvl >= n.maxLvl) ||
      (n.kind === "upgrade" && lvl >= (n.max || 1));

    if (maxed) node.classList.add("maxed");

    const owned = (meta.upgrades[n.id] > 0) || meta.unlocked[n.id];
    if (owned) node.classList.add("active");
    else if (chk.ok) node.classList.add("available");

    // --- opisy meta ---
    const lvlText = (n.kind === "upgrade")
      ? `Poziom: ${(meta.upgrades[n.id] || 0)}/${(n.max || 1)}`
      : (owned ? "Kupione" : "Do kupienia");

    const why = owned
      ? "✅ Aktywne"
      : (chk.ok ? `💰 ${cost}` : "🔒 Wymagania");

    // --- BADGE KLASY (tylko dla zakładki class) ---
    let classBadge = "";
    if (currentTreeTab === "class") {
      let clsName = "";
      if (n.id.startsWith("perk_w_")) clsName = "Wojownik ⚔️";
      else if (n.id.startsWith("perk_m_")) clsName = "Mag 🔮";
      else if (n.id.startsWith("perk_r_")) clsName = "Łotr 🗡️";
      if (clsName) classBadge = `<div class="n-badge">${clsName}</div>`;
    }

    node.innerHTML = `
      ${classBadge}
      <div class="n-title">${n.icon} ${n.name}</div>
      <div class="n-desc">${n.desc}</div>

      <div class="n-meta">
        <span>${lvlText}</span>
        <span>${why}</span>
      </div>

      <button ${chk.ok ? "" : "disabled"} onclick="buyNode('${currentTreeTab}','${n.id}')">
        ${owned ? "Kupione" : "Kup"}
      </button>
    `;
    
    // tooltip: koszt + wymagania
node.addEventListener("mouseenter", (e) => {
  const owned = (meta.upgrades[n.id] > 0) || meta.unlocked[n.id];
  const chk = canBuy(n);
  const cost = nodeCost(n);
  showTreeTooltip(e, currentTreeTab, n, chk, cost, owned);
});
node.addEventListener("mousemove", moveTreeTooltip);
node.addEventListener("mouseleave", hideTreeTooltip);

    nodesWrap.appendChild(node);
  }

  // ===== 2) Render linii EDGE→EDGE po tym, jak node'y są w DOM =====
  const drawLines = () => {
  const baseRect = linesSvg.getBoundingClientRect();

  // FIX: poprawny układ współrzędnych SVG (żeby nie znikało przy scrollu)
  const w = Math.max(1, Math.round(baseRect.width));
  const h = Math.max(1, Math.round(baseRect.height));
  linesSvg.setAttribute("width", w);
  linesSvg.setAttribute("height", h);
  linesSvg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  linesSvg.setAttribute("preserveAspectRatio", "none");

  const rectMap = {};
  nodesWrap.querySelectorAll(".tree-node").forEach(el => {
    const r = el.getBoundingClientRect();
    const id = el.dataset.nodeId;
    rectMap[id] = {
      left: r.left - baseRect.left,
      top: r.top - baseRect.top,
      width: r.width,
      height: r.height
    };
  });

  // Czyścimy linie, ale ZOSTAWIAMY defs (markery strzałek)
  const savedDefs = linesSvg.querySelector("defs");
  linesSvg.innerHTML = "";
  if (savedDefs) linesSvg.appendChild(savedDefs);

  for (const [a, b] of t.edges) {
    const ra = rectMap[a];
    const rb = rectMap[b];
    if (!ra || !rb) continue;

    const ca = { x: ra.left + ra.width / 2, y: ra.top + ra.height / 2 };
    const cb = { x: rb.left + rb.width / 2, y: rb.top + rb.height / 2 };

    const p1 = rectEdgePoint(ra, cb);
    const p2 = rectEdgePoint(rb, ca);

    const fromOwned = (meta.upgrades[a] > 0) || meta.unlocked[a];
    const toOwned = (meta.upgrades[b] > 0) || meta.unlocked[b];

    const nodeB = getNode(currentTreeTab, b);
    const toReqOk = nodeB ? meetsReq(nodeB) : false;

    let state = "locked";
    if (fromOwned && toReqOk) state = "available";
    if (fromOwned && toOwned) state = "active";

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", p1.x);
    line.setAttribute("y1", p1.y);
    line.setAttribute("x2", p2.x);
    line.setAttribute("y2", p2.y);
    line.classList.add("tree-line", state);
    line.setAttribute("marker-end", state === "locked" ? "url(#arrow-gray)" : "url(#arrow-gold)");

    linesSvg.appendChild(line);
  }
};



  requestAnimationFrame(drawLines);

  // ===== 3) Jeśli masz scrollowalny viewport, rysuj linie po scrollu =====
  const vp = document.getElementById("treeViewport");
  if (vp && !vp.dataset.boundLinesScroll) {
    vp.dataset.boundLinesScroll = "1";

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        drawLines();
      });
    };

  
    let st = 0;
  }
}


function renderHintHelpPanel() {
  const panel = document.getElementById("hintHelpPanel");
  if (!panel) return;

  panel.innerHTML = Object.entries(HINT_INFO).map(([key, h]) => {
    const left = (stats?.inventory?.[key] ?? 0);
    return `
      <div class="hint-help-item">
        <div class="hint-help-ic">${h.icon}</div>
        <div>
          <div class="hint-help-title">${h.title} <span style="opacity:.6;font-weight:800;">(masz: ${left})</span></div>
          <div class="hint-help-desc">${h.desc}</div>
        </div>
      </div>
    `;
  }).join("");
}

function toggleHintHelp() {
  const panel = document.getElementById("hintHelpPanel");
  if (!panel) return;

  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) {
    renderHintHelpPanel();
  }
}


function useHint(type) {
  const hd = document.getElementById("hintDisplay");
  hintUsedThisRound = true;
  checkBountyProgress("HINT_USED", { hintType: type });
  const left = Number(stats?.inventory?.[type] ?? 0);

  // debug-friendly komunikat
  if (left <= 0) {
    if (hd) hd.textContent = `❌ Brak tej podpowiedzi (kod widzi: ${left})`;
    return;
  }

  // zużyj
  stats.inventory[type] = left - 1;

  renderHintHelpPanel();

  if (type === "initials") {
    if (!initialsPool || initialsPool.length === 0) setupInitialsForSong(currentSong?.t);

    if (initialsRevealed.length >= initialsPool.length) {
      hd.textContent = "🔡 Wszystkie litery już odkryte";
    } else {
      const next = initialsPool[initialsRevealed.length];
      initialsRevealed.push(next);
      hd.textContent = "🔡 Litery: " + initialsRevealed.join(" • ");
    }
  }

  if (type === "artist") hd.textContent = "👤 " + (currentSong.rawTitle.split("-")[0] || "Nieznany");

  if (type === "time") {
    timeMultiplier = 3;
    hd.textContent = "⏳ Czas x3!";
  }

  if (type === "5titles") {
    const all = [...songs.filter(s => s.t !== currentSong.t).sort(() => 0.5 - Math.random()).slice(0, 4), currentSong]
      .sort(() => 0.5 - Math.random());
    const dl = document.getElementById("hints");
    dl.innerHTML = "";
    all.forEach(s => { const o = document.createElement("option"); o.value = s.t; dl.appendChild(o); });
    hd.textContent = "🎯 Lista ograniczona!";
  }

  updateRPG();
}


function offerPerks() {
  // bezpieczeństwo: jeśli coś jest nieustawione, nie blokuj gry
  if (!stats || !stats.playerClass || !CLASSES?.[stats.playerClass]) {
    showFloatingText("⚠️ Brak klasy – pomijam perki", "var(--muted)");
    // wróć na mapę albo po prostu idź dalej:
    document.getElementById('gameScreen')?.classList.add('hidden');
    document.getElementById('selectScreen')?.classList.remove('hidden');
    generatePaths?.();
    return;
  }

  const cls = CLASSES[stats.playerClass];

  // perki odblokowane levelem i jeszcze nieposiadane
  const unlocked = (cls.perks || []).filter(p => (stats.lvl || 1) >= (p.lvl || 1));
  const candidates = unlocked.filter(p => !hasPerk(perkId(p)));

  // jeśli nie ma już nic nowego do dania – nie blokuj
  if (candidates.length === 0) {
    showFloatingText("✨ Brak nowych perków", "var(--muted)");
    // wróć normalnie do wyboru ścieżek
    document.getElementById('gameScreen')?.classList.add('hidden');
    document.getElementById('selectScreen')?.classList.remove('hidden');
    generatePaths?.();
    return;
  }

  // losuj max 3 perki
  const picks = candidates.sort(() => 0.5 - Math.random()).slice(0, 3);

  // overlay
  const ov = document.createElement("div");
  ov.id = "perkPickOverlay";
  ov.style.cssText = `
    position:fixed; inset:0; z-index:7000;
    background:rgba(0,0,0,0.75);
    display:flex; align-items:center; justify-content:center;
  `;

  ov.innerHTML = `
    <div style="
      width:min(720px, 92vw);
      padding:18px;
      border-radius:18px;
      border:2px solid var(--gold);
      background:linear-gradient(135deg, rgba(26,26,46,0.96), rgba(22,33,62,0.96));
      box-shadow:0 30px 80px rgba(0,0,0,0.6);
    ">
      <div style="text-align:center; margin-bottom:14px;">
        <div style="font-size:2rem;">🎁</div>
        <div style="font-family:'Cinzel',serif; font-weight:900; letter-spacing:2px; color:var(--gold);">
          WYBIERZ PERK
        </div>
        <div style="opacity:.8; font-size:.9rem; margin-top:6px;">
          Seria ${stats.streak} • LVL ${stats.lvl}
        </div>
      </div>

      <div style="display:grid; gap:12px;">
        ${picks.map(p => {
          const id = perkId(p);
          return `
            <button data-perk="${id}" style="
              width:100%;
              text-align:left;
              padding:14px 14px;
              border-radius:14px;
              border:1px solid rgba(255,255,255,0.14);
              background:rgba(255,255,255,0.06);
              color:#fff;
              cursor:pointer;
            ">
              <div style="display:flex; align-items:center; gap:10px;">
                <div style="font-size:1.4rem;">${p.icon || "✨"}</div>
                <div style="flex:1;">
                  <div style="font-weight:900;">${p.name} <span style="opacity:.6;">(Lv.${p.lvl})</span></div>
                  <div style="opacity:.8; font-size:.85rem; margin-top:2px;">${p.desc || ""}</div>
                </div>
              </div>
            </button>
          `;
        }).join("")}
      </div>

      <button id="perkSkipBtn" style="
        margin-top:14px; width:100%;
        padding:12px;
        border-radius:14px;
        border:none;
        background:rgba(255,255,255,0.08);
        color:#fff; font-weight:900;
        cursor:pointer;
      ">POMIŃ</button>
    </div>
  `;

  document.body.appendChild(ov);

  // klik w perk
  ov.querySelectorAll("button[data-perk]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-perk");
      // wykorzystujemy Twoje applyPerk() (ona usuwa overlay i robi loadRound)
      applyPerk(id);
    });
  });

  // pomiń: usuń overlay i wróć na mapę
  ov.querySelector("#perkSkipBtn")?.addEventListener("click", () => {
    ov.remove();
    document.getElementById('gameScreen')?.classList.add('hidden');
    document.getElementById('selectScreen')?.classList.remove('hidden');
    generatePaths?.();
  });

  // klik poza kartą = pomiń
  ov.addEventListener("click", (e) => {
    if (e.target === ov) ov.querySelector("#perkSkipBtn")?.click();
  });
}

function applyPerk(type) {
    if(!hasPerk(type)) stats.perks.push(type);
    if(type === 'shield') stats.hearts++;
    document.body.lastChild.remove();
    updateRPG();
    loadRound();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const achBtn = document.querySelector('.floating-ach-btn');
  const accBtn = document.querySelector('.floating-account-btn');

  const willOpen = !sidebar.classList.contains('open');
  sidebar.classList.toggle('open');

  if (achBtn) achBtn.classList.toggle('hidden', willOpen);
  if (accBtn) accBtn.classList.toggle('hidden', willOpen);
}

function exitToMenu() {
  // zatrzymaj wideo jeśli grało
  try { if (player && player.pauseVideo) player.pauseVideo(); } catch(e) {}

  // zamknij sidebar, overlaye
  document.getElementById("sidebar")?.classList.remove("open");
  // przywróć pływające przyciski (mogły zostać ukryte przez sidebar)
document.querySelector('.floating-ach-btn')?.classList.remove('hidden');
document.querySelector('.floating-account-btn')?.classList.remove('hidden');
  document
  .querySelectorAll(".event-overlay:not(#accountOverlay), #shopOverlay, #lootModalOverlay")
  .forEach(el => el?.remove?.());

// dodatkowo: na wszelki wypadek schowaj konto (nie usuwaj)
document.getElementById("accountOverlay")?.style && (document.getElementById("accountOverlay").style.display = "none");

  // schowaj ekrany rozgrywki
  document.getElementById("gameScreen")?.classList.add("hidden");
  document.getElementById("selectScreen")?.classList.add("hidden");
  document.getElementById("classScreen")?.classList.add("hidden");

  // pokaż start/menu
  document.getElementById("startScreen")?.classList.remove("hidden");

  // nie resetujemy postępu ani localStorage
  stats.inRun = false;

  // odśwież HUD
  try { updateRPG?.(); } catch(e) {}
}

function resetStats() {
  if (confirm("Czy na pewno usunąć cały postęp, w tym LVL?")) {
    clearQuestlyStorage();
    location.reload();
  }
}
function showFloatingText(t, color = "var(--success)") {
    const el = document.createElement('div'); 
    el.className = 'floating-pts'; 
    el.textContent = t;
    
    // Losowe przesunięcie w lewo/prawo o 40px, żeby napisy na siebie nie nachodziły
    const randomOffset = (Math.random() * 80 - 40); 
    el.style.left = `calc(50% + ${randomOffset}px)`;
    el.style.color = color;
    
    document.getElementById('gameScreen').appendChild(el);
    setTimeout(() => { if(el.parentNode) el.remove(); }, 1200);
    
    // Usuwanie elementu po zakończeniu animacji
    setTimeout(() => {
        if(el.parentNode) el.remove();
    }, 1200);
}

function openShop() {
    if(player && player.pauseVideo) player.pauseVideo();
    const ov = document.createElement('div');
    ov.id = "shopOverlay";
    ov.style = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.95);z-index:4000;display:flex;flex-direction:column;align-items:center;justify-content:center;";
    
    ov.innerHTML = `
        <h1 style="color:var(--gold); margin-bottom:10px;">KRÓLEWSKI SKLEP</h1>
        <p style="margin-bottom:30px;">Twoje złoto: <b style="color:var(--gold)">${stats.points} PKT</b></p>
        <div style="display:flex; gap:15px; flex-wrap:wrap; justify-content:center;">
            <div class="choice-card" onclick="buyItem('initials', 1000)">
                <span>🔡</span><b>Litery</b><small>1000 PKT</small>
            </div>
            <div class="choice-card" onclick="buyItem('artist', 2000)">
                <span>👤</span><b>Artysta</b><small>2000 PKT</small>
            </div>
            <div class="choice-card" onclick="buyItem('time', 3000)">
                <span>⏳</span><b>Czas x3</b><small>3000 PKT</small>
            </div>
            <div class="choice-card" onclick="buyItem('heart', 5000)">
                <span>💙</span><b>Pancerz</b><small>5000 PKT</small>
            </div>
        </div>
        <button onclick="this.parentElement.remove()" style="margin-top:40px; background:none; border:none; color:white; cursor:pointer; text-decoration:underline;">Wyjdź ze sklepu</button>
    `;
    document.body.appendChild(ov);
}

function buyItem(item, price) {
    if(stats.points >= price) {
        stats.points -= price;
        if(item === 'heart') {
            stats.hearts++;
        } else {
            stats.inventory[item]++;
        }
        sfx.loot();
        showFloatingText("ZAKUPIONO! 🛒", "var(--gold)");
        updateRPG();
        // Odśwież napis złota w sklepie
        document.getElementById('shopOverlay').querySelector('b').textContent = stats.points + " PKT";
    } else {
        sfx.error();
        alert("Brak złota!");
    }
}

function selectClass(className) {
  runUnbreakUsed = false;
  const addedStartHints = [];
  if (meta.unlocked?.start_hint) {
  const keys = Object.keys(stats.inventory || {});
  if (keys.length) {
    const k = keys[Math.floor(Math.random() * keys.length)];
    stats.inventory[k] = (stats.inventory[k] || 0) + 1;
    addedStartHints.push(k);
  }
}
  runShieldActive = !!meta.unlocked?.start_shield;
  // 1) ustaw klasę
  stats.playerClass = className;

  // 2) pełny reset “runu”
  stats.points = 0;
  stats.xp = 0;
  stats.lvl = 1;
  stats.streak = 0;
  stats.currentStage = 1;
  stats.guessedSongIds = [];
  stats.rewindUsed = false;
  stats.mistakesTotal = 0;
  stats._arcaneUsed = false;
  // zabezpieczenia
  stats.perks = [];
  stats.activeBounty = null;
  stats.bountyProgress = 0;
  stats.rewindUsed = false;
  stats.mistakesTotal = 0;
  runBankGained = 0;
runBestStreak = 0;
runCorrect = 0;

  // 3) bonusy startowe klas (zawsze ustawiamy hearts + inventory, żeby nie było stanów pośrednich)
  // Mag: Arkana — start runa: +1 losowy hint (1x/run)

  
  if (className === "warrior") {
    stats.hearts = 7;
    stats.inventory = { initials: 2, artist: 1, time: 1, "5titles": 0 };
  } else if (className === "mage") {
    stats.hearts = 5;
    stats.inventory = { initials: 5, artist: 2, time: 3, "5titles": 1 };
  } else if (className === "rogue") {
    stats.hearts = 5;
    stats.inventory = { initials: 3, artist: 1, time: 1, "5titles": 0 };
  } else {
    // fallback
    stats.hearts = 5;
    stats.inventory = stats.inventory || { initials: 0, artist: 0, time: 0, "5titles": 0 };
  }

if (stats.playerClass === "mage" && hasPerk("perk_m_arcane") && !stats._arcaneUsed) {
  stats._arcaneUsed = true;

  const keys = Object.keys(stats.inventory || {});
  if (keys.length) {
    const k = keys[Math.floor(Math.random() * keys.length)];
    stats.inventory[k] = (stats.inventory[k] || 0) + 1;
    addedStartHints.push(k);
  }
}

// ===== META: startowe bonusowe serca =====
ensureMeta();
stats.hearts += (meta.upgrades.start_hearts || 0);
runShieldActive = !!meta.unlocked?.start_shield;

  // 5) UI nazwa klasy
  const names = { warrior: "WOJOWNIK", mage: "MAG", rogue: "ŁOTR" };
  const elName = document.getElementById("selectedClassName");
  if (elName) elName.textContent = names[className] || "BOHATER";

  // 6) bounty na start
  if (typeof assignNewBounty === "function") assignNewBounty();

  // 7) przełącz ekrany
  document.getElementById("classScreen")?.classList.add("hidden");
  document.getElementById("selectScreen")?.classList.remove("hidden");
  if (addedStartHints.length) showStartHintsModal(addedStartHints);
  // 8) generuj ścieżki i odśwież UI
  if (typeof generatePaths === "function") generatePaths();
  if (typeof updateRPG === "function") updateRPG();

  console.log("Klasa wybrana:", className);
}

function changeClass() {
    // Potwierdzenie pełnego resetu
    if (confirm("UWAGA: Zmiana klasy zresetuje CAŁY postęp, w tym Twój POZIOM (LVL) i XP. Czy na pewno chcesz zacząć od nowa?")) {
        
        // 1. Resetowanie wszystkich statystyk do zera
        stats.points = 0;
        stats.xp = 0;
        stats.lvl = 1;
        stats.streak = 0;
        stats.songsToday = 0;
        stats.perks = [];
        stats.playerClass = null; // Czyścimy klasę, aby wymusić nowy wybór
        
        // 2. Czyszczenie ekwipunku do stanu bazowego
        stats.inventory = { initials: 0, artist: 0, time: 0, '5titles': 0 };
        
        // 3. Zapisanie czystych statystyk w pamięci przeglądarki
        localStorage.setItem('questly_v77', JSON.stringify(stats));

        // 4. Przełączanie ekranów
        document.getElementById('selectScreen').classList.add('hidden');
        document.getElementById('gameScreen').classList.add('hidden');
        document.getElementById('classScreen').classList.remove('hidden');
        
        // 5. Odświeżenie paska postępu i tekstu w UI
        updateRPG();
        
        if (typeof sfx !== 'undefined') sfx.error(); // Dźwięk resetu
        showFloatingText("POSTĘP WYEROWANY", "var(--error)");
    }
}

// Logika autostartu:
window.onload = () => {
  showScreen("startScreen");
  updateContinueBtnVisibility();
};

const ALL_PATHS = [
    { n: 'Polskie Hity', id: 'PLC7dcp1gFw4TxWMyKG73Sd4Ku0745IPSq', i: '🇵🇱' },
    { n: 'Disney', id: 'PLOba6OKTJnLbDvwBBEwO1EaVsiICn8Svw', i: '✨' },
    { n: 'TikTok', id: 'PLSR9lWowvoE3A9i4JVVHtQFjlJt0_LItG', i: '📺' },
    { n: 'Polski Rap', id: 'PLL92dfFL9ZdKfRrEAZ8aa6wTU6Eo0Oc1I', i: '🎤' },
    { n: '90s Hits', id: 'PL7DA3D097D6FDBC02', i: '📼' },
    { n: 'Hits 2021', id: 'PLa2a9FJY91_0x1s4eq6mf9b91m3Pahv0G', i: '🌱' },
    { n: 'Marshmello ', id: 'PL4FB1JvhTLrGNSL4odYt72EqjDPJfjSdp', i: '×͜×' },
    { n: '80s', id: 'PLmXxqSJJq-yXrCPGIT2gn8b34JjOrl4Xf', i: '🎸' },
    { n: 'Imagine Dragons', id: 'PLP2m24SF_-Xo4kPbU3DGydTGr3-vedg5X', i: '🐉' },
];

function goToPathSelection() {
    // Efekt "mgły podróżnika"
    document.body.style.background = "radial-gradient(circle at center, #10121a 0%, #050507 100%)";
    stats.currentStage++;
    document.getElementById('gameScreen').classList.add('hidden');
    document.getElementById('selectScreen').classList.remove('hidden');
    generatePaths();
}


function renderGuessStats() {
    const gh = stats.guessHistory;
    const total = Object.values(gh).reduce((a, b) => a + b, 0) || 1;

    return `
        <h3 style="margin-top:25px;">Zgadywanie</h3>
        <div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">
            ${[1,2,3,4,5].map(n => {
                const label = n === 5 ? '5+' : n;
                const val = gh[n] || 0;
                const percent = Math.round((val / total) * 100);

                return `
                    <div style="display:flex; align-items:center; gap:8px;">
                        <div style="width:28px; font-weight:800;">${label}</div>
                        <div style="flex:1; height:6px; background:#222; border-radius:4px; overflow:hidden;">
                            <div style="
                                width:${percent}%;
                                height:100%;
                                background:var(--gold);
                                transition:width 0.4s;">
                            </div>
                        </div>
                        <div style="width:35px; text-align:right; font-size:0.7rem;">
                            ${val}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function updateHeroOverlay() {
    const overlay = document.getElementById('heroOverlay');
    if (!overlay) return;

    const avatar = document.getElementById('heroAvatar');
    const name = document.getElementById('heroName');
    const hearts = document.getElementById('heroHearts');
    const attempt = document.getElementById('heroAttempt');

    const classMap = {
        warrior: { icon: "⚔️", name: "Wojownik" },
        mage: { icon: "🔮", name: "Mag" },
        rogue: { icon: "🗡️", name: "Łotr" }
    };

    const cfg = classMap[stats.playerClass] || { icon: "👤", name: "Bohater" };

    avatar.textContent = cfg.icon;
    name.textContent = cfg.name;

let html = "";
const maxHearts = 5;
const current = Math.max(0, Math.min(stats.hearts, maxHearts));

for (let i = 0; i < maxHearts; i++) {
    if (i < current) {
        html += `<span class="heart full">❤️</span>`;
    } else {
        html += `<span class="heart empty">🖤</span>`;
    }
}
if (stats.hearts > 5) {
    for (let i = 0; i < stats.hearts - 5; i++) {
        html += `<span class="heart">💙</span>`;
    }
}
hearts.innerHTML = html;

    attempt.textContent = `Próba ${attemptInRound}`;
}

function triggerEvent(eventName) {
    let title = "";
    let description = "";
    let rewardText = "";
    let icon = "";

    if (eventName === 'Złota Skrzynia') {
        icon = "🎁";
        title = "Złota Skrzynia";
        
        // --- SYSTEM LOSOWEGO ŁUPU ---
        const roll = Math.random(); // Losowanie od 0.0 do 1.0
        
        if (roll > 0.95) {
            // 5% Szansy: LEGENDARNY ŁUP
            stats.inventory.initials += 5;
            stats.inventory['5titles'] += 2;
            stats.points += 1000;
            description = "Niewiarygodne! Skrzynia skrywała relikwie dawnych mistrzów muzyki. Czujesz ogromny przypływ wiedzy.";
            rewardText = "LEGENDARNY: +5 Liter, +2 Tytuły, +1000 PKT";
        } 
        else if (roll > 0.70) {
            // 25% Szansy: RZADKI ŁUP
            stats.inventory.artist += 2;
            stats.inventory.time += 2;
            description = "Skrzynia jest solidna i ciężka. W środku znajdujesz rzadkie zapiski o wielkich artystach.";
            rewardText = "RZADKI: +2 Wykonawca, +2 Czas";
        } 
        else {
            // 70% Szansy: POSPOLITY ŁUP
            stats.inventory.initials += 2;
            description = "Skrzynia jest stara i nadgryziona zębem czasu, ale wciąż skrywa przydatne wskazówki.";
            rewardText = "POSPOLITY: +2 Pierwsze Litery";
        }
        sfx.loot();
    } 
    else if (eventName === 'Mroczny Ołtarz') {
        icon = "💀";
        title = "Pakt Krwi";
        if (stats.hearts > 2) {
            stats.hearts -= 2;
            stats.points += 2000;
            description = "Mroczna siła żąda zapłaty za wiedzę. Czujesz, jak Twoja energia życiowa ulatuje, ale Twój umysł wypełnia się potęgą.";
            rewardText = "ZAPŁATA: -2❤️ | ZYSKANO: +2000 PKT";
        } else {
            title = "Ołtarz Milczy";
            description = "Jesteś zbyt słaby, by złożyć ofiarę. Głosy w Twojej głowie nakazują Ci odejść.";
            rewardText = "WYMAGANE: Minimum 3❤️";
        }
    }

    // Tworzenie modala (bez zmian w HTML/CSS)
    const overlay = document.createElement('div');
    overlay.className = 'event-overlay';
    overlay.innerHTML = `
        <div class="event-modal">
            <div style="font-size: 4rem; margin-bottom: 10px;">${icon}</div>
            <h2>${title}</h2>
            <p>${description}</p>
            <div class="reward">${rewardText}</div>
            <button class="btn" onclick="closeEvent(this)" style="width: 100%; padding: 15px; background: var(--gold); border: none; border-radius: 12px; font-weight: bold; cursor: pointer;">KONTYNUUJ PODRÓŻ</button>
        </div>
    `;
    document.body.appendChild(overlay);
    updateRPG();
}

function closeEvent(button) {
    const overlay = button.closest('.event-overlay');
    overlay.style.opacity = '0';
    setTimeout(() => {
        overlay.remove();
        generatePaths(); // Odświeżamy drogi po zamknięciu
    }, 300);
}

const BOUNTIES = [
  { id:"b_correct_8",   title:"Rutyniarz",        desc:"Traf 8 utworów.",                         type:"CORRECT_TOTAL",   goal:8,  rewardItemName:"Pakiet liter",      rewardItemKey:"initials" },
  { id:"b_first_5",     title:"Snajper",          desc:"Traf 5 razy w 1. próbie.",               type:"FIRST_TRY_COUNT", goal:5,  rewardItemName:"Lista 5 opcji",      rewardItemKey:"5titles" },
  { id:"b_streak_7",    title:"Bez zadyszki",     desc:"Zrób serię 7 trafień.",                  type:"STREAK_REACH",    goal:7,  rewardItemName:"Karta Artysty",      rewardItemKey:"artist"  },
  { id:"b_nohint_6",    title:"Purysta",          desc:"Traf 6 utworów bez podpowiedzi.",        type:"NO_HINT_COUNT",   goal:6,  rewardItemName:"Dodatkowy czas",     rewardItemKey:"time"    },
  { id:"b_fast_4",      title:"Refleks",          desc:"Traf 4 utwory w < 12s od startu rundy.",  type:"FAST_TIME_COUNT", goal:4,  maxMs:12000, rewardItemName:"Dodatkowy czas", rewardItemKey:"time"    },
  { id:"b_lowhp_3",     title:"Ostatni Oddech",   desc:"Traf 3 utwory mając 1❤️.",      type:"LOW_HP_COUNT",    goal:3,  rewardItemName:"Pakiet liter",      rewardItemKey:"initials" },

  // “smaczki” – bardziej ryzykowne
  { id:"b_nomiss_5",    title:"Perfekcjonista",   desc:"Zrób 5 trafień bez ani jednego błędu.",  type:"NO_MISS_STREAK",  goal:5,  rewardItemName:"Karta Artysty",      rewardItemKey:"artist"  },
  { id:"b_comeback_4",  title:"Powrót",           desc:"Po błędzie zrób serię 4 trafień.",        type:"COMEBACK_STREAK", goal:4,  rewardItemName:"Lista 5 opcji",      rewardItemKey:"5titles" },

  // dłuższe, spokojne
  { id:"b_paths_12",    title:"Wędrowiec",        desc:"Ukończ 12 etapów (trafień) w runie.",     type:"PATHS_DONE",      goal:12, rewardItemName:"Pakiet liter",      rewardItemKey:"initials" },

  // “anti-hint”
  { id:"b_onehint_5",   title:"Minimalista",      desc:"Ukończ 5 trafień używając max 1 hint/rundę.", type:"LIMIT_HINTS", goal:5, maxHints:1, rewardItemName:"Karta Artysty", rewardItemKey:"artist" },

  // łatwe, ale małe cele (żeby było coś na start)
  { id:"b_first_2",     title:"Rozgrzewka",       desc:"Traf 2 razy w 1. próbie.",               type:"FIRST_TRY_COUNT", goal:2,  rewardItemName:"Pakiet liter",      rewardItemKey:"initials" },
  { id:"b_nohint_3",    title:"Czysta gra",       desc:"Traf 3 utwory bez podpowiedzi.",         type:"NO_HINT_COUNT",   goal:3,  rewardItemName:"Dodatkowy czas",     rewardItemKey:"time"    },
];


function checkBountyProgress(evt, data = {}) {
  if (!stats.activeBounty) return;
  const b = stats.activeBounty;

  // pomocnicze: jeśli nie ma – zrób
  stats.bountyProgress ??= 0;
  stats.bountyState ??= {};      // stan per-bounty (np. czy był błąd, czy był comeback)
  const st = stats.bountyState;

  // --- eventy globalne
  if (evt === "WRONG") {
    st.hadWrong = true;
    st.afterWrong = true;  // dla comeback
  }

  if (evt === "HINT_USED") {
    st.hintsThisRound = (st.hintsThisRound || 0) + 1;
  }

  // --- logika per-typ
  if (b.type === "CORRECT_TOTAL") {
    if (evt === "CORRECT") stats.bountyProgress++;
  }

  if (b.type === "FIRST_TRY_COUNT") {
    if (evt === "CORRECT" && Number(data.attempt) === 1) stats.bountyProgress++;
  }

  if (b.type === "STREAK_REACH") {
    // progres = aktualny streak (czytelny pasek)
    if (evt === "CORRECT" || evt === "WRONG") stats.bountyProgress = Math.min(b.goal, stats.streak || 0);
  }

  if (b.type === "NO_HINT_COUNT") {
    if (evt === "CORRECT" && !data.usedHint) stats.bountyProgress++;
  }

  if (b.type === "FAST_TIME_COUNT") {
    const maxMs = Number(b.maxMs || 12000);
    if (evt === "CORRECT" && Number(data.timeMs || 999999) <= maxMs) stats.bountyProgress++;
  }

  if (b.type === "LOW_HP_COUNT") {
    if (evt === "CORRECT" && (stats.hearts || 0) <= 1) stats.bountyProgress++;
  }

  if (b.type === "NO_MISS_STREAK") {
    // resetuje się, jeśli był błąd
    if (evt === "WRONG") stats.bountyProgress = 0;
    if (evt === "CORRECT") stats.bountyProgress++;
  }

  if (b.type === "COMEBACK_STREAK") {
    // musi się zacząć po błędzie
    if (evt === "WRONG") {
      st.comebackCount = 0;
    }
    if (evt === "CORRECT") {
      if (st.afterWrong) {
        st.comebackCount = (st.comebackCount || 0) + 1;
        stats.bountyProgress = Math.min(b.goal, st.comebackCount);
      }
    }
    if ((st.comebackCount || 0) >= b.goal) st.afterWrong = false;
  }

  if (b.type === "PATHS_DONE") {
    // u Ciebie i tak rośnie na trafieniu jako completedPaths++ :contentReference[oaicite:11]{index=11}
    if (evt === "CORRECT") stats.bountyProgress = Math.min(b.goal, stats.completedPaths || 0);
  }

  if (b.type === "LIMIT_HINTS") {
    // każdy poprawny, jeśli w tej rundzie hintów <= maxHints
    const maxHints = Number(b.maxHints ?? 1);
    if (evt === "CORRECT") {
      const used = Number(st.hintsThisRound || 0);
      if (used <= maxHints) stats.bountyProgress++;
      st.hintsThisRound = 0; // reset na nową rundę po poprawnej
    }
    if (evt === "WRONG") st.hintsThisRound = 0;
  }

  // --- complete
  if (stats.bountyProgress >= b.goal) {
    completeBounty(); // to już daje nagrody + updateRPG :contentReference[oaicite:12]{index=12}
  } else {
    updateRPG();
  }
}


function completeBounty() {
    const b = stats.activeBounty;
    if (!b) return;

    // 1. PRZYGOTOWANIE WARTOŚCI (Zabezpieczenie przed undefined)
    const xpToAdd = parseInt(b.rewardXp) || 0;
    const pointsToAdd = parseInt(b.rewardPoints) || xpToAdd; // Jeśli nie ma rewardPoints, daj tyle co XP

    // 2. DODAWANIE NAGRÓD DO STATYSTYK
    stats.xp += xpToAdd;
    stats.points += pointsToAdd; // <--- TO DODAJE PUNKTY OGÓLNE

    // 3. DODAWANIE PRZEDMIOTU
    if (b.rewardItemKey && stats.inventory.hasOwnProperty(b.rewardItemKey)) {
  const amt = Math.max(1, Number(b.rewardItemAmount || 1));
  stats.inventory[b.rewardItemKey] += amt;
}

    // 4. GENEROWANIE OKNA SUKCESU
    const successHtml = `
        <div class="bounty-success-overlay" id="successModal">
            <div class="bounty-success-card">
                <div style="font-size: 4rem;">🏆</div>
                <h1 style="color: var(--gold); font-family: 'Cinzel', serif;">ZLECENIE WYKONANE!</h1>
                <p style="color: white; font-size: 1.1rem; margin-bottom: 20px;">${b.title}</p>
                <div class="reward-item-box">
                    <div style="font-size: 1.3rem; color: #fff;">
                        💎 +${xpToAdd} XP<br>
                        💰 +${pointsToAdd} PKT<br>
                        📦 ${b.rewardItemName || 'Przedmiot'} x${Math.max(1, Number(b.rewardItemAmount || 1))}
                    </div>
                </div>
                <button class="bounty-success-btn" onclick="closeSuccessModal()">WSPANIALE</button>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', successHtml);

    // 5. CZYSZCZENIE, AKTUALIZACJA I ZAPIS
    stats.activeBounty = null;
    stats.bountyProgress = 0;
    
    updateRPG(); // To odświeży napisy na ekranie
    localStorage.setItem('questly_v77', JSON.stringify(stats));
}

function closeSuccessModal() {
    const modal = document.getElementById('successModal');
    if (modal) {
        modal.style.opacity = '0';
        modal.style.transition = '0.3s';
        setTimeout(() => modal.remove(), 300);
    }
}

function finishPath() {
    stats.completedPaths++;

    checkBountyProgress('path_finished'); // <--- DODAJ TO

    showScreen('selectScreen');
    updateRPG();
}

let pendingBounty = null; // Przechowuje wylosowany kontrakt przed akceptacją

function computeBountyRewards(baseBounty) {
  // robimy kopię, żeby nie modyfikować stałej tablicy BOUNTIES
  const b = JSON.parse(JSON.stringify(baseBounty));

  const lvl = Math.max(1, stats.lvl || 1);

  // przykład: łagodna skala od levela (możesz zmienić)
  const lvlMult = 1 + Math.min(0.9, (lvl - 1) * 0.04);

  // przykład: większy goal = większa nagroda
  const goalMult = 1 + Math.min(0.8, (b.goal || 1) * 0.08);

  const finalXp = Math.round((b.rewardXp || 0) * lvlMult * goalMult);

  b.rewardXp = finalXp;                 // ✅ to będzie pokazane i wypłacone
  b.rewardPoints = finalXp;             // (opcjonalnie) żeby punkty też były spójne

  return b;
}

const BOUNTY_RARITIES = {
  common:    { name: "POSPOLITE",  icon: "⚪", weight: 65, goalMult: 1.0,  xpMult: 1.0,  itemMult: 1 },
  rare:      { name: "RZADKIE",    icon: "🔵", weight: 25, goalMult: 1.3,  xpMult: 1.5,  itemMult: 1 },
  epic:      { name: "EPICKIE",    icon: "🟣", weight:  8, goalMult: 1.6,  xpMult: 2.0,  itemMult: 2 },
  legendary: { name: "LEGENDARNE", icon: "🟡", weight:  2, goalMult: 2.0,  xpMult: 3.0,  itemMult: 3 },
};

function rollRarity() {
  const entries = Object.entries(BOUNTY_RARITIES);
  const total = entries.reduce((s, [,r]) => s + r.weight, 0);
  let roll = Math.random() * total;
  for (const [key, r] of entries) {
    roll -= r.weight;
    if (roll <= 0) return key;
  }
  return "common";
}
function makeBountyWithRarity(baseBounty) {
  const b = JSON.parse(JSON.stringify(baseBounty)); // nie psujemy const BOUNTIES
  const rarityKey = rollRarity();
  const R = BOUNTY_RARITIES[rarityKey];

  b.rarity = rarityKey;
  b.rarityLabel = `${R.icon} ${R.name}`;

  // trudność: podbijamy goal (minimum 1)
  const baseGoal = Math.max(1, Number(b.goal || 1));
  b.goal = Math.max(1, Math.round(baseGoal * R.goalMult));

  // nagrody: XP i PKT (u Ciebie points domyślnie = xpToAdd) :contentReference[oaicite:2]{index=2}
  const baseXp = Math.max(0, Number(b.rewardXp || 0));
  const finalXp = Math.round(baseXp * R.xpMult);

  b.rewardXp = finalXp;
  b.rewardPoints = finalXp;

  // (opcjonalnie) więcej itemów w nagrodzie
  b.rewardItemAmount = R.itemMult;

  return b;
}

function assignNewBounty() {
    if (stats.activeBounty) return;

    // 1. Losujemy kontrakt
    const picked = BOUNTIES[Math.floor(Math.random() * BOUNTIES.length)];
pendingBounty = makeBountyWithRarity(picked);
pendingBounty = scaleBountyRewards(pendingBounty);

    // 2. Tworzymy i pokazujemy Modal
    const modalHtml = `
        <div class="bounty-modal-overlay" id="bountyModal">
            <div class="bounty-modal-card">
                <div style="font-size: 3rem; margin-bottom: 15px;">📜</div>
                <h2 style="color: var(--gold); font-family: 'Cinzel', serif; margin-bottom: 10px;">NOWE ZLECENIE</h2>
                <h3 style="color: #fff;">${pendingBounty.title}</h3>
                <div style="margin-top:6px; font-size:0.75rem; letter-spacing:2px; color:var(--gold); opacity:0.9;">
  ${pendingBounty.rarityLabel}
</div>
                <p style="color: #ccc; font-style: italic; font-size: 0.9rem; margin: 15px 0;">"${pendingBounty.desc}"</p>
                <div style="margin-top:10px; font-size:0.8rem; color:#bbb;">
  Cel: <b style="color:#fff;">${pendingBounty.goal}</b>
</div>
                <div style="font-size: 0.7rem; color: #888; text-transform: uppercase; letter-spacing: 1px;">Nagroda za ukończenie:</div>
                <div class="reward-badge">
                    💎 ${pendingBounty.rewardXp} XP &nbsp; 📦 ${pendingBounty.rewardItemName}
                </div>

                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button class="bounty-btn-accept" onclick="confirmBounty()">PRZYJMIJ</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function confirmBounty() {
    if (!pendingBounty) return;

    // Oficjalnie przypisujemy kontrakt do statystyk
    stats.activeBounty = JSON.parse(JSON.stringify(pendingBounty));
    stats.bountyProgress = 0;
    
    closeBountyModal();
        // 🔒 Nie pozwalaj zamykać, jeśli ktoś próbuje “uciec” bez przyjęcia
    if (pendingBounty && !stats.activeBounty) return;

    const modal = document.getElementById('bountyModal');
    if (modal) modal.remove();
    pendingBounty = null;
    updateRPG(); // Natychmiastowe odświeżenie UI
    showFloatingText("📜 KONTRAKT ROZPOCZĘTY", "var(--gold)");
}

function closeBountyModal() {
    const modal = document.getElementById('bountyModal');
    if (modal) modal.remove();
    pendingBounty = null;

}

function renderBountyUI() {
    const bountyContainer = document.getElementById('bountyUi');
    if (!bountyContainer) return;

    if (stats.activeBounty) {
        const b = stats.activeBounty;
        const progress = Math.min((stats.bountyProgress / b.goal) * 100, 100);
        
        bountyContainer.innerHTML = `
            <div class="bounty-panel">
                <div style="font-size: 2.2rem; filter: drop-shadow(0 0 8px var(--gold));">📜</div>
                <div style="flex-grow: 1; text-align: left;">
                    <div style="font-size: 0.65rem; color: var(--gold); letter-spacing: 2px; font-weight: 800; margin-bottom: 4px;">AKTYWNY KONTRAKT</div>
                    <div style="font-size: 1.1rem; font-weight: bold; color: #fff; margin-bottom: 2px;">${b.title}</div>
                    <div style="font-size: 0.8rem; color: #aaa; margin-bottom: 10px; font-style: italic;">${b.desc}</div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div style="flex-grow: 1; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                            <div style="width: ${progress}%; height: 100%; background: var(--gold); box-shadow: 0 0 10px var(--gold); transition: width 0.6s;"></div>
                        </div>
                        <span style="font-size: 0.75rem; font-weight: bold; color: var(--gold); min-width: 40px; text-align: right;">${stats.bountyProgress}/${b.goal}</span>
                    </div>
                </div>
            </div>`;
    } else {
        bountyContainer.innerHTML = `
            <div class="bounty-empty-card" onclick="assignNewBounty()">
                <div class="bounty-add-icon">+</div>
                <div class="label">NOWY KONTRAKT</div>
                <div class="sub-label">Gildia czeka na Twoją odpowiedź...</div>
            </div>`;
    }
}

function gameOver() {
  setRoundLocked?.(true);
  try { player?.pauseVideo?.(); } catch (e) {}

  // policz podsumowanie zanim cokolwiek zmienisz
  const stageReached = Math.max(0, (stats.currentStage || 1) - 1);
  const runPoints = stats.points || 0;

  // jeśli masz global selectedDifficulty, to pokaże też nazwę trudności
  const diffKey = (typeof selectedDifficulty !== "undefined") ? selectedDifficulty : "easy";

  showRunResultModal({
    type: "LOSE",
    title: "POLEGŁEŚ!",
    icon: "💀",
    diffKey,
    summary: {
      stageReached,
      runPoints,
      bankGained: runBankGained // ile wpadło do banku w tym runie (jeśli to liczysz)
    }
  });
}


function closePerkModal() {
    document.getElementById('perkModal').classList.add('hidden');
}

const CLASSES = {
  warrior: {
    name: "Wojownik",
    icon: "⚔️",
    perks: [
      { nodeId:"perk_w_thick",    icon:"🛡️", name:"Pancerz",        desc:"Co 3. utrata serca jest anulowana (licznik w runie)." },
      { nodeId:"perk_w_momentum", icon:"🔥", name:"Momentum",       desc:"Gdy masz streak ≥3: +15% XP i PKT za trafienie." },
      { nodeId:"perk_w_unbreak",  icon:"💢", name:"Ostatni Bastion", desc:"Gdy masz 1❤️: 1. pomyłka nie zabiera serca (1x/run)." },
    ]
  },

  mage: {
    name: "Mag",
    icon: "🔮",
    perks: [
      { nodeId:"perk_m_resonance", icon:"🔊", name:"Rezonans", desc:"Każda próba: +0.5s audio (w tej rundzie)." },
      { nodeId:"perk_m_arcane",    icon:"✨", name:"Arkana",   desc:"Start runa: +1 losowy hint (1x/run)." },
      { nodeId:"perk_m_focus",     icon:"🧠", name:"Skupienie",desc:"Po użyciu hintu w rundzie: +10% XP za trafienie." },
    ]
  },

  rogue: {
    name: "Łotr",
    icon: "🗡️",
    perks: [
      { nodeId:"perk_r_first",  icon:"🎯", name:"Pierwsza Krew", desc:"1. próba: +25% PKT i +15% XP." },
      { nodeId:"perk_r_shadow", icon:"👣", name:"Shadow Step",   desc:"Pierwszy błąd w runie nie resetuje serii (1x/run)." },
      { nodeId:"perk_r_crit",   icon:"💥", name:"Krytyk",        desc:"20% szansy na x2 PKT za trafienie." },
    ]
  }
};


function applyVolumeConfirmed() {
  const slider = document.getElementById("volSlider");
  if (!slider || !window.player) return;
  if (!window.player) {
  showFloatingText?.("Player jeszcze nie gotowy", "var(--error)");
  return;
}

  const vol = Math.max(0, Math.min(100, Number(slider.value)));

  localStorage.setItem("questly_volume", vol);

  const label = document.getElementById("volLabel");
  if (label) label.textContent = vol + "%";

  try {
    player.setVolume(vol);
    if (vol === 0) player.mute();
    else player.unMute();
  } catch(e){}
}

function bountyDifficulty(b) {
  let d = 1;

  // goal skaluje (większy cel = trudniej)
  d += (Number(b.goal || 1) - 1) / 6;

  // typy – ile “trudności” dodajemy
  if (b.type === "STREAK_REACH")      d += 0.9;
  if (b.type === "FIRST_TRY_COUNT")   d += 0.8;
  if (b.type === "NO_HINT_COUNT")     d += 0.8;
  if (b.type === "FAST_TIME_COUNT")   d += 0.9;
  if (b.type === "LOW_HP_COUNT")      d += 1.0;
  if (b.type === "NO_MISS_STREAK")    d += 1.1;

  return Math.max(1, Math.min(3.2, d));
}

function scaleBountyRewards(b) {
  const d = bountyDifficulty(b);

  const base = 220 + (stats.lvl * 30);      
  b.rewardXp = Math.round(base * d);
  b.rewardPoints = b.rewardXp;             
  return b;
}

document
  .getElementById("applyVolumeBtn")
  ?.addEventListener("click", applyVolumeConfirmed);

document.addEventListener("input", (e) => {
  if (e.target.id === "volSlider") {
    const v = Math.max(0, Math.min(100, Number(e.target.value)));
    const label = document.getElementById("volLabel");
    if (label) label.textContent = v + "%";
  }
});

function enforceVolume() {
  const vol = Number(localStorage.getItem("questly_volume"));
  if (!window.player || !Number.isFinite(vol)) return;

  try {
    player.setVolume(vol);
    if (vol === 0) player.mute();
    else player.unMute();
  } catch(e){}
}

function showRunResultModal({ type, title, icon, diffKey, summary }) {
  const d = (typeof DIFFICULTIES !== "undefined" && diffKey && DIFFICULTIES[diffKey])
    ? DIFFICULTIES[diffKey]
    : null;

  // --- wyciągnij staty z summary (z fallbackami) ---
  const stageReached = Number(summary?.stageReached ?? 0);
  const runPoints    = Number(summary?.runPoints ?? 0);
  const bankGained   = Number(summary?.bankGained ?? (typeof runBankGained !== "undefined" ? runBankGained : 0));

  const hits   = (typeof runCorrect !== "undefined") ? Number(runCorrect) : 0;
  const bestSt = (typeof runBestStreak !== "undefined") ? Number(runBestStreak) : 0;

  // --- overlay ---
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position:fixed; inset:0;
    z-index:12000;
    background:rgba(0,0,0,0.78);
    display:flex; align-items:center; justify-content:center;
  `;

  overlay.innerHTML = `
    <div style="
      width:min(560px, 92vw);
      padding:22px 20px;
      border-radius:18px;
      border:2px solid var(--gold);
      background:linear-gradient(135deg, rgba(26,26,46,0.96), rgba(22,33,62,0.96));
      box-shadow:0 30px 80px rgba(0,0,0,0.6);
      text-align:center;
    ">

      <div style="font-size:2.2rem; margin-bottom:6px;">${icon}</div>
      <div style="font-weight:900; letter-spacing:2px; color:var(--gold);">
        ${title}
      </div>

      <div style="margin-top:10px; opacity:.9; font-size:.95rem;">
        ${d ? `Trudność: <b>${d.name}</b> (x${d.mult})` : ""}
      </div>

      <div style="margin:16px 0; display:grid; gap:10px; font-size:1.05rem; text-align:left;">
        <div>🏁 Etap: <b>${stageReached}</b></div>
        <div>🎯 Trafienia: <b>${hits}</b></div>
        <div>🔥 Najlepszy streak: <b>${bestSt}</b></div>
        <div>💰 Punkty w runie: <b>${runPoints}</b></div>
        <div>🏦 Do banku: <b>+${bankGained}</b></div>
      </div>

      <div style="display:flex; gap:10px; margin-top:14px;">
        <button id="runMenuBtn" style="
          flex:1;
          padding:12px 12px;
          border-radius:14px;
          border:1px solid rgba(255,255,255,0.14);
          background:rgba(255,255,255,0.06);
          color:#fff; font-weight:900; cursor:pointer;">
          MENU
        </button>

        ${type === "WIN" ? `
          <button id="runAgainBtn" style="
            flex:1;
            padding:12px 12px;
            border-radius:14px;
            border:none;
            background:var(--gold);
            color:#000; font-weight:900; cursor:pointer;">
            ZAGRAJ PONOWNIE
          </button>
        ` : ""}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // --- zablokuj HUD tylko na czas modala (i ZAWSZE przywróć) ---
  const hudEls = Array.from(document.querySelectorAll(".minimal-hud"));
  const prevPE = hudEls.map(el => el.style.pointerEvents);
  hudEls.forEach(el => el.style.pointerEvents = "none");

  const restoreHud = () => {
    hudEls.forEach((el, i) => el.style.pointerEvents = prevPE[i] ?? "");
  };

  // --- twardy reset runa: kasuje możliwość Continue ---
  const hardResetRunNoContinue = () => {
    // reset runa (bez ruszania META/banku w meta)
    stats.points = 0;
    stats.xp = 0;
    stats.lvl = 1;
    stats.hearts = 5;
    stats.streak = 0;
    stats.currentStage = 1;
    stats.guessedSongIds = [];
    stats.rewindUsed = false;
    stats.mistakesTotal = 0;
    stats.activeBounty = null;
    stats.bountyProgress = 0;
    stats.songsToday = 0;

    // KLUCZ: brak klasy => nie da się Continue
    stats.playerClass = null;

    // wyczyść podsumowania runa
    if (typeof runBankGained !== "undefined") runBankGained = 0;
    if (typeof runBestStreak !== "undefined") runBestStreak = 0;
    if (typeof runCorrect !== "undefined") runCorrect = 0;

    // usuń zapis runa
    clearQuestlyStorage();
  };

  // --- MENU: zawsze startScreen + brak Continue ---
  const goMenu = () => {
  runUnbreakUsed = false;
  restoreHud?.();      // jeśli masz
  overlay.remove();

  // HARD RESET RUNA -> żeby nie było "Continue"
  stats.playerClass = null;
  localStorage.removeItem("questly_v77");   // kluczowe :contentReference[oaicite:5]{index=5}

  // (opcjonalnie) wyzeruj runowe liczniki w pamięci
  stats.points = 0;
  stats.xp = 0;
  stats.lvl = 1;
  stats.streak = 0;
  stats.currentStage = 1;
  stats.guessedSongIds = [];
  stats.rewindUsed = false;
  stats.mistakesTotal = 0;

  if (typeof runBankGained !== "undefined") runBankGained = 0;
  if (typeof runBestStreak !== "undefined") runBestStreak = 0;
  if (typeof runCorrect !== "undefined") runCorrect = 0;

  showScreen("startScreen");
  updateContinueBtnVisibility(); // <-- od razu chowa Continue
};

  // --- ZAGRAJ PONOWNIE: wybór klasy (nowy run) + brak Continue ---
  const playAgain = () => {
    runUnbreakUsed = false;
    restoreHud();
    overlay.remove();
    hardResetRunNoContinue();
    if (typeof showScreen === "function") showScreen("classScreen");
    else {
      document.getElementById("gameScreen")?.classList.add("hidden");
      document.getElementById("selectScreen")?.classList.add("hidden");
      document.getElementById("startScreen")?.classList.add("hidden");
      document.getElementById("classScreen")?.classList.remove("hidden");
    }
  };

  overlay.querySelector("#runMenuBtn")?.addEventListener("click", goMenu);
  overlay.querySelector("#runAgainBtn")?.addEventListener("click", playAgain);

  // klik w tło = MENU
  overlay.addEventListener("click", (e) => { if (e.target === overlay) goMenu(); });
}




function showGuessSuccessModal({
  points,
  xp,
  attempt,
  maxAttempts,
  dropLabel
}) {
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:6000;
    background:rgba(0,0,0,0.7);
    display:flex; align-items:center; justify-content:center;
  `;

  overlay.innerHTML = `
    <div style="
      width:min(520px, 92vw);
      padding:22px 20px;
      border-radius:18px;
      border:2px solid var(--gold);
      background:linear-gradient(135deg, rgba(26,26,46,0.95), rgba(22,33,62,0.95));
      box-shadow:0 30px 80px rgba(0,0,0,0.6);
      text-align:center;
    ">
      <div style="font-size:2.5rem;">🎶</div>

      <div style="margin-top:6px; font-family:'Cinzel',serif;
        font-size:1.2rem; font-weight:900; letter-spacing:2px;
        color:var(--gold);">
        TRAFIONE!
      </div>

      <div style="margin-top:10px; color:#fff; font-size:0.95rem;">
        Próba: <b>${attempt}/${maxAttempts}</b>
      </div>

      <div style="margin:16px 0; display:grid; gap:10px;">
        <div>💰 <b>+${points}</b> PKT</div>
        <div>✨ <b>+${xp}</b> XP</div>
        <div>🎁 Drop: <b>${dropLabel || "Brak"}</b></div>
      </div>

      <button id="successContinueBtn" style="
        margin-top:16px;
        width:100%;
        padding:12px;
        border-radius:14px;
        border:none;
        background:var(--gold);
        color:#000;
        font-weight:900;
        cursor:pointer;
      ">
        KONTYNUUJ PODRÓŻ
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector("#successContinueBtn").addEventListener("click", () => {
    overlay.remove();

    if (player && player.pauseVideo) player.pauseVideo();

    document.getElementById("gameScreen").classList.add("hidden");
    document.getElementById("selectScreen").classList.remove("hidden");
    generatePaths();
  });
}

// =========================
//  ACHIEVEMENTS (🏆)
// =========================

const ACHIEVEMENTS = [
  {
    id: "first_correct",
    icon: "🎵",
    title: "Pierwszy strzał",
    desc: "Odgadnij pierwszy utwór.",
    bonusXp: 150,
    unlocked: (s) => (s.totalCorrect || 0) >= 1
  },
  {
    id: "streak_5",
    icon: "🔥",
    title: "Seria 5",
    desc: "Zrób serię 5 poprawnych odpowiedzi.",
    bonusXp: 250,
    unlocked: (s) => (s.streak || 0) >= 5
  },
  {
    id: "streak_10",
    icon: "🏅",
    title: "Seria 10",
    desc: "Zrób serię 10 poprawnych odpowiedzi.",
    bonusXp: 500,
    unlocked: (s) => (s.streak || 0) >= 10
  },
  {
    id: "path_1",
    icon: "🌀",
    title: "Pierwsza ścieżka",
    desc: "Ukończ 1 ścieżkę (etap).",
    bonusXp: 400,
    unlocked: (s) => (s.completedPaths || 0) >= 1
  },
  {
    id: "correct_25",
    icon: "📀",
    title: "25 trafień",
    desc: "Odgadnij 25 utworów łącznie.",
    bonusXp: 700,
    unlocked: (s) => (s.totalCorrect || 0) >= 25
  }
];

function ensureAchievementsState() {
  // totalCorrect może nie istnieć w starym sejwie
  if (stats.totalCorrect == null) stats.totalCorrect = 0;

  if (!stats.achievements) {
    stats.achievements = {
      unlocked: {}, // { [id]: { at: timestamp } }
      claimed: {}   // { [id]: true }
    };
  }
  if (!stats.achievements.unlocked) stats.achievements.unlocked = {};
  if (!stats.achievements.claimed) stats.achievements.claimed = {};
}

function toggleAchievements() {
  const modal = document.getElementById("achievementsModal");
  if (!modal) return;

  modal.classList.toggle("hidden");
  if (!modal.classList.contains("hidden")) {
    renderAchievements();
  }
}

function renderAchievements() {
  ensureAchievementsState();

  const list = document.getElementById("achievementsList");
  if (!list) return;

  const items = ACHIEVEMENTS.map(a => {
    const isUnlocked = !!stats.achievements.unlocked[a.id];
    const isClaimed = !!stats.achievements.claimed[a.id];

    const badge = !isUnlocked
      ? "ZABLOK."
      : isClaimed
        ? "ODEBRANE"
        : `+${a.bonusXp} XP`;

    const cls = `ach-item ${isUnlocked ? "" : "locked"}`.trim();

    const clickAttr = isUnlocked ? `onclick="openAchievement('${a.id}')"` : "";

    return `
      <div class="${cls}" ${clickAttr} style="${isUnlocked ? "cursor:pointer;" : ""}">
        <div class="ach-ic">${a.icon}</div>
        <div class="ach-meta">
          <b>${a.title}</b>
          <small>${isUnlocked ? a.desc : "???"}</small>
        </div>
        <div class="ach-badge">${badge}</div>
      </div>
    `;
  }).join("");

  list.innerHTML = items || `<div style="opacity:.7;">Brak osiągnięć.</div>`;
}

function openAchievement(id) {
  ensureAchievementsState();
  
  const a = ACHIEVEMENTS.find(x => x.id === id);
  if (!a) return;

  const isUnlocked = !!stats.achievements.unlocked[id];
  if (!isUnlocked) return;

    // ✅ schowaj listę osiągnięć, zostaw tylko okno szczegółów
  const achModal = document.getElementById("achievementsModal");
  if (achModal) achModal.classList.add("hidden");

  const claimed = !!stats.achievements.claimed[id];

  // Prosty modal “info + odbierz”
  const ov = document.createElement("div");
  ov.style.cssText = `
    position:fixed; inset:0; z-index:6000;
    background:rgba(0,0,0,0.72);
    display:flex; align-items:center; justify-content:center;
  `;

  ov.innerHTML = `
    <div style="
      width:min(520px, 92vw);
      padding:18px 16px;
      border-radius:18px;
      border:1px solid rgba(255,255,255,0.14);
      background:linear-gradient(135deg, rgba(26,26,46,0.95), rgba(22,33,62,0.95));
      box-shadow:0 30px 80px rgba(0,0,0,0.6);
      color:#fff;
    ">
      <div style="display:flex; gap:12px; align-items:center;">
        <div style="font-size:2rem;">${a.icon}</div>
        <div>
          <div style="font-weight:900; font-size:1.1rem;">${a.title}</div>
          <div style="opacity:.8; margin-top:2px;">${a.desc}</div>
        </div>
      </div>

      <div style="margin-top:12px; opacity:.85; font-size:.9rem;">
        Bonus: <b style="color:var(--gold);">+${a.bonusXp} XP</b>
      </div>

      ${
        claimed
        ? `<button class="ach-claim" disabled style="opacity:.55; cursor:not-allowed;">ODEBRANE</button>`
        : `<button class="ach-claim" onclick="claimAchievement('${a.id}')">ODBIERZ BONUS</button>`
      }

      <button class="ach-claim" onclick="this.closest('div[style]').parentElement.remove()"
              style="margin-top:10px; opacity:.85;">
        Zamknij
      </button>
    </div>
  `;

  document.body.appendChild(ov);

  const kill = () => { try { ov.remove(); } catch(e) {} };
  ov.addEventListener("click", (e) => { if (e.target === ov) kill(); });
}

function claimAchievement(id) {
  ensureAchievementsState();

  const a = ACHIEVEMENTS.find(x => x.id === id);
  if (!a) return;

  if (!stats.achievements.unlocked[id]) return;
  if (stats.achievements.claimed[id]) return;

  stats.achievements.claimed[id] = true;

  // wypłata XP
  stats.xp = (stats.xp || 0) + (a.bonusXp || 0);

  // feedback
  if (typeof showFloatingText === "function") {
    showFloatingText(`🏆 ${a.title} +${a.bonusXp} XP`, "var(--gold)");
  }

  if (typeof updateRPG === "function") updateRPG();
  localStorage.setItem("questly_v77", JSON.stringify(stats));

  // odśwież listę jeśli modal osiągnięć jest otwarty
  const modal = document.getElementById("achievementsModal");
  if (modal && !modal.classList.contains("hidden")) renderAchievements();
}

function checkAchievements() {
  ensureAchievementsState();

  let unlockedNow = 0;

  for (const a of ACHIEVEMENTS) {
    const already = !!stats.achievements.unlocked[a.id];
    if (already) continue;

    let ok = false;
    try { ok = !!a.unlocked(stats); } catch (e) { ok = false; }

    if (ok) {
      stats.achievements.unlocked[a.id] = { at: Date.now() };
      unlockedNow++;

      // info: odblokowane (bez auto-claim)
      if (typeof showFloatingText === "function") {
        showFloatingText(`🏆 Odblokowano: ${a.title}`, "var(--gold)");
      }
    }
  }

  if (unlockedNow > 0) {
    localStorage.setItem("questly_v77", JSON.stringify(stats));
  }
}


function setAuthStatus(msg, isError=false){
  const el = document.getElementById("authStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isError ? "var(--error)" : "var(--gold)";
}

async function authSignUp(){
  try{
    const email = document.getElementById("authEmail")?.value?.trim();
    const password = document.getElementById("authPass")?.value;
    if (!email || !password) return setAuthStatus("Podaj e-mail i hasło.", true);

    setAuthStatus("Rejestruję...");
    const { data, error } = await supa.auth.signUp({ email, password });
    if (error) return setAuthStatus(error.message, true);

    // jeśli masz włączone potwierdzenie maila w Supabase:
    setAuthStatus("Sprawdź e-mail i potwierdź konto ✅");
  } catch(e){
    setAuthStatus(String(e), true);
  }
}

async function authSignIn(){
  try{
    const email = document.getElementById("authEmail")?.value?.trim();
    const password = document.getElementById("authPass")?.value;
    if (!email || !password) return setAuthStatus("Podaj e-mail i hasło.", true);

    setAuthStatus("Loguję...");
    const { data, error } = await supa.auth.signInWithPassword({ email, password });
    if (error) return setAuthStatus(error.message, true);

    cloudUser = data.user;
    refreshCloudLabel();

    // ✅ KLUCZ: pobierz zapis z chmury i nadpisz lokalny
    await cloudPull();

    setAuthStatus(`Zalogowano jako: ${data.user.email}`);
    closeAuth();
    document.getElementById("accountOverlay").style.display = "flex";
  } catch(e){
    setAuthStatus(String(e), true);
  }
}



// jeśli używasz onclick="" w HTML, to MUSI być na window:
window.openAuth = openAuth;
window.closeAuth = closeAuth;
window.authSignUp = authSignUp;
window.authSignIn = authSignIn;
window.authSignOut = authSignOut;


window.openSkillTrees = openSkillTrees;
window.closeSkillTrees = closeSkillTrees;
window.switchTreeTab = switchTreeTab;

updateRPG();
