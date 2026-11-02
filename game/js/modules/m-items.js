// ================================================================
// 模块：道具商店（m-items）
// 地图上把一张「机会」改造成「道具商店 🛍️」（迷你图只有一张机会格则不改造，
// 改用顶栏「🛍️ 商店」按钮，随时可进）。道具分两类：
//   被动：免租卡（付租金全额免除）、加倍卡（向对手收租翻倍）—— 命中即自动消耗
//   主动：路障、遥控骰子、拆迁卡 —— 玩家点玩家卡上的道具图标使用
// 所有道具每种最多持有 2 张，库存随存档保存（mods.items）。
// 核心钩子：payWaivers / payFilters / rollFilters / stepBlockers / turnStart。
// ================================================================
Game.use('items', () => {
  const ITEMS = {
    rent:   { icon:'🎫', name:'免租卡',   price:140, active:false,
              desc:'被动：下次支付租金时自动全额免除' },
    double: { icon:'💹', name:'加倍卡',   price:160, active:false,
              desc:'被动：下次向对手收租时租金翻倍' },
    block:  { icon:'🚧', name:'路障',     price:100, active:true,
              desc:'主动：放在身前 1~9 格，之后经过的对手被迫停下（不挡自己）' },
    dice:   { icon:'🎲', name:'遥控骰子', price:180, active:true,
              desc:'主动：指定下一回合的落点（前方 2~12 格），骰子自动凑出该点数' },
    demo:   { icon:'🏗️', name:'拆迁卡',   price:220, active:true,
              desc:'主动：拆掉对手一块地上的一级建筑' },
  };
  const ORDER = ['rent', 'double', 'block', 'dice', 'demo'];
  const MAX_PER = 2;

  let inv = [];        // pi -> { rent, double, block, dice, demo }
  let blocks = [];     // [{ pos, by }] 场上的路障
  let force = {};      // pi -> 下一回合锁定的总点数

  const invOf = pi => {
    if (!inv[pi]) inv[pi] = { rent:0, double:0, block:0, dice:0, demo:0 };
    return inv[pi];
  };
  const addItem = (pi, k, n = 1) => {
    const v = invOf(pi);
    v[k] = Math.min(MAX_PER, (v[k] || 0) + n);
  };
  const spendItem = (pi, k) => {
    const v = invOf(pi);
    if (!v[k]) return false;
    v[k]--;
    return true;
  };
  const totalItems = pi => ORDER.reduce((s, k) => s + (invOf(pi)[k] || 0), 0);

  // ---------------- 地块：把一张机会改成商店 ----------------
  Game.beforeBoard.push(() => {
    const chances = TILES.map((t, i) => (t.type === 'chance' ? i : -1)).filter(i => i >= 0);
    if (chances.length >= 2){
      const pick = chances[chances.length - 1];
      TILES[pick] = { type:'shop', name:'道具商店', emoji:'🛍️' };
    }
  });

  Game.tileHandlers.shop = async (pi) => {
    const p = players[pi];
    log(`🛍️ ${p.name} 走进道具商店`, 'card');
    if (p.isAI){ await sleep(450); aiShop(pi); return; }
    await openShop(pi);
  };

  // ---------------- 被动道具：走付款钩子 ----------------
  // 免租卡：支付租金时全额免除（只在真正付款时触发，看租金预览不会白白消耗）
  Game.payWaivers.push((from, to, amount, reason) => {
    if (to === null || amount <= 0 || !/租金/.test(reason)) return amount;
    const p = players[from];
    if (!spendItem(from, 'rent')) return amount;
    log(`🎫 ${p.name} 使用免租卡，本次「${reason}」¥${amount} 全额免除`, 'good');
    renderPlayers();
    return null;
  });

  // 加倍卡：向对手收租时翻倍（付款方视角过滤，实收翻倍）
  Game.payFilters.push((from, to, amount, reason) => {
    if (to === null || amount <= 0 || !/租金/.test(reason)) return amount;
    const owner = players[to];
    if (!owner || owner.bankrupt || !spendItem(to, 'double')) return amount;
    log(`💹 ${owner.name} 使用加倍卡，「${reason}」翻倍为 ¥${amount * 2}`, 'good');
    renderPlayers();
    return amount * 2;
  });

  // ---------------- 遥控骰子：改写掷骰结果 ----------------
  Game.rollFilters.push((pi, faces) => {
    const total = force[pi];
    if (!total) return faces;
    delete force[pi];
    // 拆成两颗 1~6 的点数，优先不掷出双数（避免遥控顺便白送一次续行）
    const pairs = [];
    for (let a = 1; a <= 6; a++){
      const b = total - a;
      if (b >= 1 && b <= 6) pairs.push([a, b]);
    }
    if (!pairs.length) return faces;
    const uneven = pairs.filter(([a, b]) => a !== b);
    const pick = (uneven.length ? uneven : pairs)[Math.floor(Math.random() * (uneven.length || pairs.length))];
    log(`🎲 ${players[pi].name} 使用遥控骰子，锁定 ${total} 点`, 'card');
    return pick;
  });

  // ---------------- 路障：逐格拦截 ----------------
  Game.stepBlockers.push((pi, nextPos) => {
    const k = blocks.findIndex(b => b.pos === nextPos && b.by !== pi);
    if (k < 0) return false;
    const b = blocks.splice(k, 1)[0];
    drawBlocks();
    log(`🚧 ${players[pi].name} 撞上 ${players[b.by].name} 放的路障，被迫停在「${TILES[nextPos].name}」`, 'bad');
    return true;
  });

  // ---------------- 视觉：路障标记 ----------------
  function drawBlocks(){
    document.querySelectorAll('.block-mark').forEach(el => el.remove());
    blocks.forEach(b => {
      const el = $('tile' + b.pos);
      if (!el) return;
      const d = document.createElement('div');
      d.className = 'block-mark';
      d.textContent = '🚧';
      el.appendChild(d);
    });
  }

  // ---------------- 道具徽章（玩家卡） ----------------
  Game.badges.push(pi => {
    const v = invOf(pi);
    const chips = ORDER.filter(k => v[k] > 0).map(k =>
      `<span class="item-chip" data-pi="${pi}" title="${ITEMS[k].name}：${ITEMS[k].desc}">${ITEMS[k].icon}${v[k] > 1 ? '×' + v[k] : ''}</span>`
    ).join('');
    return chips ? `<span class="item-chips">${chips}</span>` : '';
  });

  // 徽章点击 = 打开使用面板（只对「当前行动的真人玩家」生效）
  Game.afterRender.push(() => {
    document.querySelectorAll('.item-chip').forEach(el => {
      el.onclick = () => {
        const pi = +el.dataset.pi;
        if (gameOver || busy || pi !== turn || players[pi].isAI) return;
        openUse(pi);
      };
    });
  });

  // ---------------- 商店 UI ----------------
  function openShop(pi){
    return new Promise(resolve => {
      const p = players[pi];
      const render = () => {
        $('shopDesc').innerHTML =
          `现金 <b>¥${p.money}</b>　·　每种最多 ${MAX_PER} 张　·　被动道具命中即自动使用`;
        $('shopList').innerHTML = ORDER.map(k => {
          const it = ITEMS[k], have = invOf(pi)[k] || 0;
          const can = p.money >= it.price && have < MAX_PER;
          return `<div class="shop-item">
            <div class="si-ico">${it.icon}</div>
            <div class="si-main">
              <div class="si-name">${it.name}${have ? `<span class="si-have">持有 ${have}</span>` : ''}</div>
              <div class="si-desc">${it.desc}</div>
            </div>
            <button class="si-buy" data-k="${k}" ${can ? '' : 'disabled'}>¥${it.price}</button>
          </div>`;
        }).join('');
        $('shopList').querySelectorAll('.si-buy').forEach(btn => {
          btn.onclick = () => {
            const k = btn.dataset.k, it = ITEMS[k];
            if (players[pi].money < it.price || (invOf(pi)[k] || 0) >= MAX_PER) return;
            players[pi].money -= it.price;
            addItem(pi, k);
            log(`🛍️ ${p.name} 购入「${it.icon} ${it.name}」（-¥${it.price}）`, 'card');
            renderPlayers();
            render();
          };
        });
      };
      render();
      $('shopModal').classList.remove('hidden');
      $('shopClose').onclick = () => { $('shopModal').classList.add('hidden'); resolve(); };
    });
  }

  // ---------------- 使用面板 ----------------
  function openUse(pi){
    const p = players[pi];
    const v = invOf(pi);
    if (!totalItems(pi)){
      openShop(pi);   // 身上没货就直接进店，少点一次
      return;
    }
    $('useTitle').textContent = '🎒 使用道具';
    $('useDesc').innerHTML = `${p.name} 的道具（被动道具命中时自动触发，无需手动使用）`;
    $('useList').innerHTML = ORDER.filter(k => v[k] > 0).map(k => {
      const it = ITEMS[k];
      return `<div class="shop-item">
        <div class="si-ico">${it.icon}</div>
        <div class="si-main">
          <div class="si-name">${it.name}<span class="si-have">持有 ${v[k]}</span></div>
          <div class="si-desc">${it.desc}</div>
        </div>
        <button class="si-buy" data-k="${k}">${it.active ? '使用' : '被动'}</button>
      </div>`;
    }).join('');
    $('useList').querySelectorAll('.si-buy').forEach(btn => {
      const k = btn.dataset.k;
      if (!ITEMS[k].active){ btn.disabled = true; return; }
      btn.onclick = () => showTargets(pi, k);
    });
    $('useModal').classList.remove('hidden');
    $('useClose').onclick = () => $('useModal').classList.add('hidden');
  }

  // 目标选择（路障 / 遥控骰子 / 拆迁卡）
  function showTargets(pi, kind){
    const p = players[pi], N = TILES.length;
    let rows = [];
    if (kind === 'block' || kind === 'dice'){
      const [lo, hi] = kind === 'block' ? [1, 9] : [2, 12];
      for (let d = lo; d <= hi; d++){
        const pos = (p.pos + d) % N;
        if (pos === 0) continue;                    // 不往起点放（否则会吞掉过路工资）
        if (blocks.some(b => b.pos === pos)) continue;
        const t = TILES[pos], own = tileOwner[pos];
        const tag = own === undefined ? '无主'
          : own === pi ? '自己的地'
          : `${players[own].name} 的地 · 租 ¥${rentOf(pos)}`;
        rows.push(`<button class="tgt" data-pos="${pos}" data-d="${d}">
          <span class="tgt-d">+${d}</span>
          <span class="tgt-n">${t.name}</span>
          <span class="tgt-t">${tag}</span></button>`);
      }
    } else if (kind === 'demo'){
      TILES.forEach((t, i) => {
        const own = tileOwner[i];
        if (own === undefined || own === pi || (tileLevel[i] || 0) <= 0) return;
        rows.push(`<button class="tgt" data-pos="${i}" data-d="0">
          <span class="tgt-d">拆</span>
          <span class="tgt-n">${t.name}</span>
          <span class="tgt-t">${players[own].name} · ${LEVEL_NAME[tileLevel[i]]} · 租 ¥${rentOf(i)}</span></button>`);
      });
    }
    $('useTitle').textContent = kind === 'block' ? '🚧 把路障放在哪一格？'
      : kind === 'dice' ? '🎲 下一回合想去哪？'
      : '🏗️ 拆谁的房？';
    $('useDesc').innerHTML = `<span style="font-size:12px;color:#9C9789">${ITEMS[kind].desc}</span>`;
    $('useList').innerHTML = rows.length ? rows.join('')
      : `<div class="si-desc" style="padding:8px 2px">当前没有可选目标。</div>`;
    $('useList').querySelectorAll('.tgt').forEach(b => {
      b.onclick = () => {
        const pos = +b.dataset.pos, d = +b.dataset.d;
        if (!spendItem(pi, kind)) return;
        if (kind === 'block'){
          blocks.push({ pos, by: pi });
          drawBlocks();
          log(`🚧 ${p.name} 在「${TILES[pos].name}」放下路障`, 'card');
        } else if (kind === 'dice'){
          force[pi] = d;
          log(`🎲 ${p.name} 用遥控骰子锁定「${TILES[pos].name}」（${d} 点）`, 'card');
        } else {
          tileLevel[pos] = (tileLevel[pos] || 0) - 1;
          refreshTile(pos);
          log(`🏗️ ${p.name} 用拆迁卡拆掉「${TILES[pos].name}」的一级建筑`, 'bad');
        }
        $('useModal').classList.add('hidden');
        renderPlayers();
        saveGame();
      };
    });
    $('useClose').onclick = () => $('useModal').classList.add('hidden');
  }

  // ---------------- AI ----------------
  function aiShop(pi){
    const p = players[pi];
    const affordable = ORDER.filter(k => ITEMS[k].price <= p.money - 200 && (invOf(pi)[k] || 0) < MAX_PER);
    if (!affordable.length){ log(`🛍️ ${p.name} 逛了一圈，什么都没买`); return; }
    const k = affordable[Math.floor(Math.random() * affordable.length)];
    p.money -= ITEMS[k].price;
    addItem(pi, k);
    log(`🛍️ ${p.name} 购入「${ITEMS[k].icon} ${ITEMS[k].name}」（-¥${ITEMS[k].price}）`, 'card');
    renderPlayers();
  }

  Game.turnStart.push(pi => {
    const p = players[pi];
    if (!p.isAI || p.bankrupt || gameOver) return;
    const v = invOf(pi);
    // 拆迁卡：优先拆全场租金最高的对手地产
    if (v.demo > 0){
      let best = -1, bestRent = 0;
      TILES.forEach((t, i) => {
        const own = tileOwner[i];
        if (own === undefined || own === pi || (tileLevel[i] || 0) <= 0) return;
        const r = rentOf(i);
        if (r > bestRent){ bestRent = r; best = i; }
      });
      if (best >= 0){
        spendItem(pi, 'demo');
        tileLevel[best] = (tileLevel[best] || 0) - 1;
        refreshTile(best);
        log(`🏗️ ${p.name} 用拆迁卡拆掉「${TILES[best].name}」的一级建筑`, 'bad');
      }
    }
    // 遥控骰子：在前方 2~12 格里挑一块「无主可买 / 自己的地 / 便宜租」的
    if (v.dice > 0){
      let best = 0, bestScore = -1e9;
      for (let d = 2; d <= 12; d++){
        const pos = (p.pos + d) % TILES.length;
        if (pos === 0) continue;
        const t = TILES[pos], own = tileOwner[pos];
        let score = 0;
        if (own === undefined && (t.type === 'prop' || t.type === 'station' || t.type === 'utility')) score = 200 - d;
        else if (own === pi) score = 60 - d;
        else if (own !== undefined) score = -(rentOf(pos) / 10) - d;
        else if (t.type === 'shop') score = 40 - d;
        if (score > bestScore){ bestScore = score; best = d; }
      }
      if (best > 0){
        spendItem(pi, 'dice');
        force[pi] = best;
        log(`🎲 ${p.name} 用遥控骰子锁定 ${best} 点`, 'card');
      }
    }
    // 路障：领先时给身后放一块，拦追兵
    if (v.block > 0 && Math.random() < 0.6){
      const d = 3 + Math.floor(Math.random() * 6);
      const pos = (p.pos + d) % TILES.length;
      if (pos !== 0 && !blocks.some(b => b.pos === pos)){
        spendItem(pi, 'block');
        blocks.push({ pos, by: pi });
        drawBlocks();
        log(`🚧 ${p.name} 在「${TILES[pos].name}」放下路障`, 'card');
      }
    }
  });

  // ---------------- 顶栏商店按钮 ----------------
  function ensureBtn(){
    if (document.getElementById('shopBtn')) return;
    const host = document.querySelector('.topbar .actions');
    if (!host) return;
    const b = document.createElement('button');
    b.className = 'btn-ghost';
    b.id = 'shopBtn';
    b.textContent = '🛍️ 商店';
    b.title = '在自己的回合随时进店；地图上的「道具商店」格也可以逛';
    b.onclick = () => {
      if (gameOver) return;
      const p = players[turn];
      if (p.isAI || busy){ log('🛍️ 只能在自己回合进店'); return; }
      const open = document.getElementById('shopModal');
      if (open && !open.classList.contains('hidden')) return;
      openShop(turn);
    };
    host.insertBefore(b, host.firstChild);
  }

  // ---------------- 存档 ----------------
  Game.saveExtras.push(() => ({
    items: { inv: inv.map(v => ({ ...(v || {}) })), blocks: blocks.map(b => ({ ...b })), force: { ...force } },
  }));
  Game.loadExtras.push(sv => {
    const m = sv.mods && sv.mods.items;
    if (!m) return;
    inv = players.map((_, pi) => Object.assign({ rent:0, double:0, block:0, dice:0, demo:0 }, (m.inv && m.inv[pi]) || {}));
    blocks = (m.blocks || []).filter(b => b && Number.isFinite(b.pos) && b.pos >= 0 && b.pos < TILES.length);
    force = m.force || {};
    setTimeout(drawBlocks, 60);   // 棋盘渲染完再画路障
  });

  Game.onStart.push(() => {
    inv = players.map(() => ({ rent:0, double:0, block:0, dice:0, demo:0 }));
    blocks = [];
    force = {};
    ensureBtn();
    setTimeout(drawBlocks, 60);
    log('🛍️ 道具商店已开门：地图「道具商店」格或顶栏「🛍️ 商店」可购买（免租卡 / 加倍卡 / 路障 / 遥控骰子 / 拆迁卡）');
  });

  Game.itemsApi = { ITEMS, ORDER, invOf, totalItems, openShop, openUse, getBlocks: () => blocks.slice() };
});
