const MODE_TEST = true;

const $ = (s)=>document.querySelector(s);

let state = {
  xp: 0,
  gold: 0,
  inventory: [],
  history: []
};

let itemsCatalog = {};
let content = null;
let merchantData = null;

async function loadJSON(path) {
  const url = chrome.runtime.getURL(path);
  const res = await fetch(url);
  return await res.json();
}

function saveState() { return chrome.storage.sync.set(state); }
async function loadState() {
  const s = await chrome.storage.sync.get(null);
  state = Object.assign(state, s || {});
  state.xp ??= 0; state.gold ??= 0;
  state.inventory ??= []; state.history ??= [];
}

function levelFromXP(xp) { return Math.floor(xp / 100) + 1; }

function renderHUD() {
  $("#goldVal").textContent = state.gold;
  $("#levelVal").textContent = levelFromXP(state.xp);
  // V3.3 XP bar
  const pct = (state.xp % 100);
  const fill = document.getElementById("xpBarFill");
  const txt = document.getElementById("xpBarText");
  if (fill) fill.style.width = pct + "%";
  if (txt) txt.textContent = (state.xp % 100) + " / 100 XP";
  // Update merchant header gold if open
  const mg = document.getElementById("merchantGoldVal");
  if (mg) mg.textContent = state.gold;
}

function renderInventory() {
  const ul = $("#inv"); ul.innerHTML = "";
  for (const id of state.inventory) {
    const meta = itemsCatalog[id] || { name: id, icon:"", consumable:false };
    const li = document.createElement("li");
    li.className = "item";
    const slot = document.createElement("div"); slot.className = "slot";
    const img = document.createElement("img");
    img.src = chrome.runtime.getURL(meta.icon || "assets/icons/chest.png");
    img.alt = meta.name || id;
    slot.appendChild(img);
    const label = document.createElement("label"); label.textContent = meta.name || id;
    li.append(slot, label);
    ul.appendChild(li);
  }
}

function haveItem(id) { return state.inventory.includes(id); }
function addItem(id) { if (!id) return; state.inventory.push(id); }
function removeItem(id) { const i = state.inventory.indexOf(id); if (i>=0) state.inventory.splice(i,1); }

function applyEffects(eff={}, requiresItem, consumeRequired) {
  state.xp += eff.xp || 0;
  state.gold += eff.gold || 0;
  if (eff.addItem) addItem(eff.addItem);
  if (eff.removeItem) removeItem(eff.removeItem);
  if (requiresItem) {
    const meta = itemsCatalog[requiresItem];
    if (consumeRequired || (meta && meta.consumable)) {
      removeItem(requiresItem);
    }
  }
  renderHUD();
}

function showFeedback(text, type="info") {
  const fb = $("#feedback"); fb.classList.remove("hidden","info","success","fail");
  fb.classList.add(type);
  $("#fbText").textContent = text || "";
  const icon = type==="success" ? "✅" : type==="fail" ? "❌" : "ℹ️";
  $("#fbIcon").textContent = icon;
  // small animation
  fb.animate([{opacity:0, transform:"scale(0.98)"},{opacity:1, transform:"scale(1)"}], {duration:140, easing:"ease-out"});
  // small sound via WebAudio (beep)
  try {
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = type==="success" ? 880 : type==="fail" ? 220 : 440;
    o.connect(g); g.connect(ctx.destination);
    g.gain.value = 0.02;
    o.start(); setTimeout(()=>{o.stop();ctx.close();}, 120);
  } catch(e) {}
}

function recapShow(recap) {
  const box = $("#recapBox"); const sum = $("#recapSummary");
  box.classList.remove("hidden");
  const lines = [];
  lines.push(`• XP gagné : +${recap.xp}`);
  lines.push(`• Or gagné : ${recap.gold>=0?'+':''}${recap.gold} PO`);
  if (recap.itemsGained.length) lines.push(`• Objets obtenus : ${recap.itemsGained.map(id=>itemsCatalog[id]?.name || id).join(', ')}`);
  if (recap.itemsLost.length) lines.push(`• Objets consommés/perdus : ${recap.itemsLost.map(id=>itemsCatalog[id]?.name || id).join(', ')}`);
  lines.push(MODE_TEST ? "👉 (Mode test) Vous pouvez lancer une nouvelle quête immédiatement." : "Votre aventure du jour s’achève… Revenez demain pour la suite de votre légende !");
  sum.innerHTML = lines.join("<br>");
  // V3.3: mark today's play for reminder logic
  (async ()=>{
    const d = new Date();
    const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0');
    await chrome.storage.sync.set({ lastPlayedDay: `${y}-${m}-${dd}` });
  })();
  $("#newQuestBtn").onclick = () => startNewQuest();
}

function disableUnavailableChoices(stepEl, step) {
  const buttons = stepEl.querySelectorAll("button.choice");
  buttons.forEach((btn, idx) => {
    const c = step.choices[idx];
    if (c.requiresItem && !haveItem(c.requiresItem)) {
      btn.disabled = true;
      btn.title = `Requiert : ${itemsCatalog[c.requiresItem]?.name || c.requiresItem}`;
    }
  });
}

let currentQuest = null;
let stepIndex = 0;
let recapAcc = { xp:0, gold:0, itemsGained:[], itemsLost:[] };
let ended = false;

function pick(arr){ return arr[Math.floor(Math.random()*arr.length)] }

function buildQuest() {
  const ilot = pick(content.ilots);
  const quest = Object.assign({}, pick(ilot.quests));
  quest._ilotName = ilot.name;
  return quest;
}

function lockChoices() {
  document.querySelectorAll("button.choice").forEach(b=>b.disabled=true);
}

function classifyFeedback(effects) {
  if ((effects?.gold||0) < 0) return "fail";
  if ((effects?.xp||0) >= 6 || (effects?.gold||0) > 0 || effects?.addItem) return "success";
  return "info";
}

function renderStep() {
  ended = false;
  const step = currentQuest.steps[stepIndex];
  $("#stepText").textContent = step.text;
  const wrap = $("#choices"); wrap.innerHTML = "";
  step.choices.forEach((c) => {
    const btn = document.createElement("button");
    btn.className = "choice";
    btn.textContent = c.label;
    btn.addEventListener("click", async () => {
      if (ended) return;
      const beforeInv = state.inventory.slice();
      // Combat first if present
      if (c.combat && window.triggerCombat) {
        const res = await window.triggerCombat(c.combat);
        if (res && (res.xp||0 || res.gold||0)) {
          const extra = { xp: (res.xp||0), gold: (res.gold||0) };
          applyEffects(extra);
          recapAcc.xp += (extra.xp||0);
          recapAcc.gold += (extra.gold||0);
        }
      }
      applyEffects(c.effects || {}, c.requiresItem, c.consumeRequired);
      recapAcc.xp += (c.effects?.xp || 0);
      recapAcc.gold += (c.effects?.gold || 0);
      const afterInv = state.inventory.slice();
      afterInv.forEach(id => { if (!beforeInv.includes(id)) recapAcc.itemsGained.push(id) });
      beforeInv.forEach(id => { if (!afterInv.includes(id)) recapAcc.itemsLost.push(id) });

      renderInventory(); saveState();
      showFeedback(c.feedback || "", classifyFeedback(c.effects));

      stepIndex++;
      if (stepIndex < currentQuest.steps.length) {
        setTimeout(()=>renderStep(), 220);
      } else {
        ended = true;
        lockChoices();
        recapShow(recapAcc);
        state.history.unshift({
          at: new Date().toISOString(),
          ilot: currentQuest._ilotName,
          title: currentQuest.title,
          xpDelta: recapAcc.xp,
          goldDelta: recapAcc.gold,
          itemsGained: recapAcc.itemsGained,
          itemsLost: recapAcc.itemsLost
        });
        state.history = state.history.slice(0,30);
        saveState();
      }
    });
    wrap.appendChild(btn);
  });
  disableUnavailableChoices(wrap, step);
}

async function startNewQuest() {
  $("#recapBox").classList.add("hidden");
  $("#feedback").classList.add("hidden");
  recapAcc = { xp:0, gold:0, itemsGained:[], itemsLost:[] };
  currentQuest = buildQuest();
  stepIndex = 0;
  $("#ilotName").textContent = currentQuest._ilotName;
  $("#questTitle").textContent = currentQuest.title;
  renderStep();
}

/* ---------- Merchant UI ---------- */
function openMerchant() {
  // V3.4.1 modal guard: hide any non-merchant modal (tutorial, etc.)
  document.querySelectorAll('.modal').forEach(m=>{ if (m && m.id!=='merchantModal') m.classList.add('hidden'); });
  const modal = $("#merchantModal"); modal.classList.remove("hidden");
  const mg = document.getElementById("merchantGoldVal"); if (mg) mg.textContent = state.gold;
  renderMerchant();
}
function closeMerchant() {
  $("#merchantModal").classList.add("hidden");
}
function setActiveTab(name) {
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active", t.dataset.tab===name));
  document.querySelectorAll(".tab-panel").forEach(p=>p.classList.add("hidden"));
  $("#tab-"+name).classList.remove("hidden");
}
function renderMerchant() {
  // BUY
  const buyPanel = $("#tab-buy"); buyPanel.innerHTML = "";
  merchantData.buy.forEach(entry=>{
    const meta = itemsCatalog[entry.id];
    const row = document.createElement("div"); row.className="shop-item";
    row.innerHTML = `
      <div class="info">
        <img src="${chrome.runtime.getURL(meta.icon)}" alt="">
        <div>
          <div>${meta.name}</div>
        </div>
      </div>
      <div class="price">
        <img src="${chrome.runtime.getURL('assets/icons/po.png')}" alt="PO"><span>${entry.price}</span>
        <button class="buybtn">Acheter</button>
      </div>`;
    const btn = row.querySelector(".buybtn");
    const can = state.gold >= entry.price;
    if (!can) btn.disabled = true;
    btn.addEventListener("click", ()=>{
      if (state.gold >= entry.price) {
        state.gold -= entry.price;
        addItem(entry.id);
        renderHUD(); renderInventory(); saveState();
        showFeedback(`Achat: ${meta.name} (-${entry.price} PO)`, "success");
        renderMerchant();
      }
    });
    buyPanel.appendChild(row);
  });

  // SELL
  const sellPanel = $("#tab-sell"); sellPanel.innerHTML = "";
  const counts = {};
  state.inventory.forEach(id=>counts[id]=(counts[id]||0)+1);
  Object.keys(counts).forEach(id=>{
    const meta = itemsCatalog[id]; if (!meta) return;
    const base = merchantData.buy.find(b=>b.id===id)?.price || 6; // default base price if not in shop
    const price = Math.max(1, Math.floor(base * (merchantData.sell_multiplier||0.5)));
    const row = document.createElement("div"); row.className="shop-item";
    row.innerHTML = `
      <div class="info">
        <img src="${chrome.runtime.getURL(meta.icon)}" alt="">
        <div>
          <div>${meta.name}</div>
          <small>Quantité: ${counts[id]}</small>
        </div>
      </div>
      <div class="price">
        <img src="${chrome.runtime.getURL('assets/icons/po.png')}" alt="PO"><span>+${price}</span>
        <button class="sellbtn">Vendre</button>
      </div>`;
    row.querySelector(".sellbtn").addEventListener("click", ()=>{
      removeItem(id);
      state.gold += price;
      renderHUD(); renderInventory(); saveState();
      showFeedback(`Vente: ${meta.name} (+${price} PO)`, "info");
      renderMerchant();
    });
    sellPanel.appendChild(row);
  });

  setActiveTab("buy");
}

(async function init(){
  // Ensure tutorial modal is hidden by default
  try { document.getElementById('tutorialModal')?.classList.add('hidden'); } catch(e) {}
  itemsCatalog = await loadJSON("content/items.json");
  content = await loadJSON("content/ilots_fantasy.json");
  merchantData = await loadJSON("content/merchant.json");
  await loadState();
  renderHUD();
  renderInventory();
  $("#modeLabel").textContent = "(Mode test activé)";
  $("#merchantBtn").addEventListener("click", openMerchant);
  $("#closeMerchant").addEventListener("click", closeMerchant);
  document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click", ()=>setActiveTab(t.dataset.tab)));
  startNewQuest();

  // Options button
  document.getElementById("optionsBtn")?.addEventListener("click", ()=> chrome.runtime.openOptionsPage());

  // First-run tutorial
  try {
    const sAll = await chrome.storage.sync.get(null);
    if (!sAll.hasSeenTutorial) {
      document.getElementById("tutorialModal")?.classList.remove("hidden");
      document.getElementById("closeTutorial")?.addEventListener("click", ()=>{
        document.getElementById("tutorialModal").classList.add("hidden");
      });
      document.getElementById("tutorialGotIt")?.addEventListener("click", async ()=>{
        document.getElementById("tutorialModal").classList.add("hidden");
        await chrome.storage.sync.set({ hasSeenTutorial: true });
      });
    }
  } catch(e) {}

  // V3.3: show pinning tip on first run
  try {
    const s = await chrome.storage.sync.get(null);
    if (s.firstRunV33) {
      document.getElementById('pinTip')?.classList.remove('hidden');
      // clear flag so it shows only once
      chrome.storage.sync.set({ firstRunV33: false });
    }
  } catch(e) {}

})();