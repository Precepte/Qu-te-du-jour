
// V3.4 combat (Promise-based, rewards returned to caller; inventory may be modified for potion use)
(function(){
  const $ = (s)=>document.querySelector(s);
  function ensureCombatDOM(){
    if (document.getElementById('combatModal')) return;
    const wrap = document.createElement('div');
    wrap.id = 'combatModal';
    wrap.className = 'modal hidden';
    wrap.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-card" style="width:360px">
        <div class="modal-header">
          <h3>Combat</h3>
          <button id="combatClose" class="close">✕</button>
        </div>
        <div class="tab-panel" id="combatPanel">
          <div id="combatLog" style="min-height:90px;color:#cfe3ff;margin-bottom:8px"></div>
          <div class="bars" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
            <div style="flex:1">
              <div style="font-size:12px;color:#9fb0c9">Vous</div>
              <div class="xpbar"><div id="hpYou" class="xpbar-fill" style="width:100%"></div></div>
            </div>
            <div style="flex:1">
              <div style="font-size:12px;color:#9fb0c9">Ennemi</div>
              <div class="xpbar"><div id="hpEnemy" class="xpbar-fill" style="width:100%"></div></div>
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <button id="combatAttack" class="primary">Attaquer (1d6)</button>
            <button id="combatPotion">Boire une potion</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    $("#combatClose").onclick = ()=> wrap.classList.add('hidden');
  }

  async function getState(){ return await chrome.storage.sync.get(null); }
  async function setState(s){ return await chrome.storage.sync.set(s); }
  function roll(){ return Math.floor(Math.random()*6)+1; }

  function triggerCombat(enemy){
    return new Promise(async (resolve)=>{
      ensureCombatDOM();
      const modal = document.getElementById('combatModal');
      modal.classList.remove('hidden');
      const log = document.getElementById('combatLog');
      const hpYou = document.getElementById('hpYou');
      const hpEnemy = document.getElementById('hpEnemy');

      const st = await getState();
      let youHP = 10; let enemyHP = enemy.hp ?? 8;
      const youAtk = (st.inventory||[]).includes('sword') ? 1 : 0;
      const youArmor = (st.inventory||[]).includes('leather_armor') ? 1 : 0;

      function render(){ hpYou.style.width = Math.max(0, (youHP*10))+'%'; hpEnemy.style.width = Math.max(0, enemyHP*(100/(enemy.hp??8)))+'%'; }
      render();
      log.innerHTML = `Un ${enemy.name||'ennemi'} vous attaque !`;

      document.getElementById('combatAttack').onclick = async ()=>{
        const a = roll() + youAtk;
        const d = roll() + (enemy.bonus||0);
        if (a >= d){
          const dmg = Math.max(1, Math.round(1 + (a - d)/3));
          enemyHP -= dmg;
          log.innerHTML = `Vous touchez (${a} vs ${d}) ! (-${dmg} PV)`;
        } else {
          const raw = Math.max(1, Math.round(1 + (d - a)/3));
          const got = Math.max(0, raw - youArmor);
          youHP -= got;
          log.innerHTML = `Vous êtes touché (${a} vs ${d}). Armure bloque ${Math.min(raw, youArmor)}.`;
        }
        render();
        if (enemyHP <= 0){
          const xpG = enemy.xp ?? 10;
          const goldG = enemy.gold ?? 3;
          log.innerHTML = `Victoire ! +${xpG} XP, +${goldG} PO.`;
          setTimeout(()=>{ modal.classList.add('hidden'); resolve({ result:'victory', xp: xpG, gold: goldG }); }, 600);
        } else if (youHP <= 0){
          log.innerHTML = `Défaite… Vous perdez 2 PO.`;
          setTimeout(()=>{ modal.classList.add('hidden'); resolve({ result:'defeat', gold: -2 }); }, 600);
        }
      };

      document.getElementById('combatPotion').onclick = async ()=>{
        const s = await getState();
        const inv = s.inventory||[];
        const idx = inv.indexOf('potion');
        if (idx === -1){ log.innerHTML = `Vous n'avez pas de potion.`; return; }
        inv.splice(idx,1);
        await setState({ inventory: inv });
        youHP = Math.min(10, youHP + 4);
        render();
        if (window.renderInventory) window.renderInventory();
        log.innerHTML = `Vous buvez une potion (+4 PV).`;
      };
    });
  }

  window.triggerCombat = triggerCombat;
})();
