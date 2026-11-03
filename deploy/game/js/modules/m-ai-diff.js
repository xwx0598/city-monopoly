// ================================================================
// 模块：AI 三档难度（m-ai-diff）
// URL 参数 buy/build/tactic = easy|normal|hard，可逐项混搭；
// 整体替换核心的默认 AI 策略（Game.ai），模块关闭时核心用朴素 AI。
// ================================================================
Game.use('ai-diff', () => {
  const DIFF_LEVELS = ['easy', 'normal', 'hard'];
  const AI_DIFF_NAME = { easy: '简单', normal: '普通', hard: '困难' };
  const AI_DIFF_DESC = {
    easy:   '随手买地、从不盖房',
    normal: '稳健扩张，有余钱就盖房',
    hard:   '算回报、抢垄断、阻击对手',
  };
  const DIFF_TAG_BG = { easy: '#E7EBEE', normal: '#F3EAE0', hard: '#F3E4E2', custom: '#F0EDE6' };
  const DIFF_TAG_FG = { easy: '#5F6C78', normal: '#8E6B4E', hard: '#A05752', custom: '#8B8779' };
  const diffQS = k => DIFF_LEVELS.includes(QS.get(k)) ? QS.get(k) : 'normal';

  // ---- AI 性格（叠加在难度之上）：persona=tycoon|renter|bully|mixed|off，默认 mixed ----
  // mixed 时按玩家序号轮换分配（pi=0 是人类），确定性分配让存档天然一致，无需额外存状态
  const PERSONAS = {
    tycoon: { name:'圈地狂', desc:'看见地就想买，砍价不眨眼', bg:'#EFE0DC', fg:'#A05752' },
    renter: { name:'收租佬', desc:'只收车站电站，地产非垄断不碰', bg:'#E4E9E2', fg:'#5E7A5A' },
    bully:  { name:'老赖',   desc:'拍卖场里专门抬价阻击领先者', bg:'#E9E3F0', fg:'#6F5E8E' },
  };
  const PERSONA_CYCLE = ['tycoon', 'renter', 'bully'];
  const personaQS = QS.get('persona') || '';
  let personaMode = ['tycoon','renter','bully','mixed','off'].includes(personaQS) ? personaQS : 'mixed';
  function personaOf(pi){
    if (GAME_MODE !== 'ai' || personaMode === 'off') return null;
    if (personaMode !== 'mixed') return personaMode;
    return PERSONA_CYCLE[(pi - 1) % PERSONA_CYCLE.length] || null;   // pi=0 人类没有性格
  }
  const AI_ATTR = GAME_MODE === 'ai' ? { buy: diffQS('buy'), build: diffQS('build'), tactic: diffQS('tactic') } : null;
  const AI_ATTR_LABEL = { buy: '买地', build: '建房', tactic: '策略' };
  function aiOverall(){
    const v = [AI_ATTR.buy, AI_ATTR.build, AI_ATTR.tactic];
    return v.every(x => x === v[0]) ? v[0] : 'custom';
  }

  function groupState(pi, i){
    const g = TILES[i].group;
    const mates = TILES.map((t, k) => (t.type === 'prop' && t.group === g) ? k : -1).filter(k => k >= 0);
    return {
      size: mates.length,
      mine: mates.filter(k => tileOwner[k] === pi).length,
      opp:  mates.filter(k => tileOwner[k] !== undefined && tileOwner[k] !== pi).length,
    };
  }

  function aiWantsBuy(pi, i){
    const p = players[pi], t = TILES[i];
    if (p.money < t.price) return false;

    // 性格优先于难度：圈地狂什么都想要；收租佬只碰车站/电站/补垄断
    const ps = personaOf(pi);
    if (ps === 'tycoon') return p.money - t.price >= 50;
    if (ps === 'renter'){
      if (t.type === 'station' || t.type === 'utility') return p.money - t.price >= 150;
      return groupState(pi, i).mine === groupState(pi, i).size - 1 && p.money - t.price >= 250;
    }

    const style = AI_ATTR.buy;
    if (style === 'easy') return Math.random() < 0.6;  // 付得起就六成概率随手买

    const s = groupState(pi, i);
    if (style === 'normal'){
      if (s.opp >= 2) return false;                    // 会被对手占优的组不接盘
      return p.money - t.price >= 150;                 // 留 ¥150 安全垫就买
    }

    // hard：会算账
    const completingMine = s.mine === s.size - 1;                    // 买下即凑齐垄断
    const blockingOpp   = AI_ATTR.tactic === 'hard' && s.opp === s.size - 1;  // 对手只差这一块，必须阻击
    const buffer = (completingMine || blockingOpp) ? 50 : 250;
    if (p.money - t.price < buffer) return false;
    if (s.opp >= 2 && !blockingOpp) return false;      // 组里对手已占两块以上，不值得接盘
    return true;
  }

  function aiBuildPolicy(pi, preferIdx){
    const p = players[pi];
    const style = AI_ATTR.build;
    if (style === 'easy') return;                       // 简单：从不建房

    aiMaybeUnmortgage(pi);                              // 有闲钱先赎回抵押地产

    // 均衡建设：只在 canBuildAt 允许的地块上加盖（同组 1-1-1 → 2-2-2 → 3-3-3）
    let cands = p.props.filter(i => TILES[i].type === 'prop' && canBuildAt(pi, i));
    if (personaOf(pi) === 'renter') cands = cands.filter(i => ownsWholeGroup(pi, TILES[i].group));
    if (!cands.length) return;

    // 排序：垄断组优先 → 等级低优先（性价比） → 地价低优先
    cands.sort((a, b) => {
      const ma = ownsWholeGroup(pi, TILES[a].group) ? 1 : 0;
      const mb = ownsWholeGroup(pi, TILES[b].group) ? 1 : 0;
      if (ma !== mb) return mb - ma;
      const la = tileLevel[a] || 0, lb = tileLevel[b] || 0;
      if (la !== lb) return la - lb;
      return TILES[a].price - TILES[b].price;
    });

    if (style === 'normal'){
      if (p.money - buildCost(cands[0], pi) < 400) return;
      buildProperty(pi, cands[0]);
      return;
    }

    // hard：留 ¥500 安全垫
    if (p.money - buildCost(cands[0], pi) < 500) return;
    buildProperty(pi, cands[0]);
  }

  // 拍卖出价上限：按难度给不同心理价位（竞拍时不超过现金-100 安全垫）
  // 硬约束与 aiWantsBuy 同一套：性格不碰的地、会被对手占优的组，拍卖价再便宜也不拍——
  // 否则会出现"刚才死活不买、进拍卖抢着出价"的人格分裂
  function aiBidValue(pi, i){
    const t = TILES[i], p = players[pi];
    const s = groupState(pi, i);
    const ps = personaOf(pi);
    if (ps === 'renter' && t.type !== 'station' && t.type !== 'utility' && s.mine !== s.size - 1) return 0;
    if (s.opp >= 2 && !(AI_ATTR && AI_ATTR.tactic === 'hard' && s.opp === s.size - 1)) return 0;
    const style = AI_ATTR ? AI_ATTR.buy : 'normal';
    let factor = style === 'easy' ? 0.5 : style === 'normal' ? 0.7 : 0.9;
    if (ps === 'tycoon') factor += 0.1;                                          // 圈地狂舍得加价
    if (ps === 'renter' && (t.type === 'station' || t.type === 'utility')) factor += 0.2;
    if (ps === 'bully') factor += 0.2;                                           // 老赖为阻击而抬价
    if (s.mine === s.size - 1) factor += 0.25;                                  // 买下即凑齐垄断 → 舍得加钱
    if (AI_ATTR && AI_ATTR.tactic === 'hard' && s.opp === s.size - 1) factor += 0.2;  // 阻击对手凑垄断
    const cap = Math.min(Math.round(t.price * factor), p.money - 100);
    return Math.max(0, Math.floor(cap / 10) * 10);
  }

  // 监狱策略：先赌一把双数；后续按难度决定是否保释
  function aiJailPolicy(pi){
    const p = players[pi];
    if (p.jail >= 3) return 'roll';   // 刚进来先试一次运气
    const style = AI_ATTR ? AI_ATTR.tactic : 'normal';
    if (style === 'hard') return p.money >= 250 ? 'bail' : 'roll';
    if (style === 'normal') return p.money >= 400 ? 'bail' : 'roll';
    return 'roll';                    // easy：能赌就赌
  }

  if (GAME_MODE === 'ai'){
    Game.ai = { wantsBuy: aiWantsBuy, build: aiBuildPolicy, bidValue: aiBidValue, jailPolicy: aiJailPolicy };
    Game.aiDiffStyle = aiOverall;   // 供其他模块（如交易）读取当前难度风格

    // 玩家名后缀：难度标签
    Game.nameSuffix.push(pi => {
      const p = players[pi];
      if (!p.isAI) return '';
      const o = aiOverall();
      let html = `<span class="diff-tag" style="background:${DIFF_TAG_BG[o]};color:${DIFF_TAG_FG[o]}">${AI_DIFF_NAME[o] || '自定义'}</span>`;
      const ps = personaOf(pi);
      if (ps) html += ` <span class="diff-tag" style="background:${PERSONAS[ps].bg};color:${PERSONAS[ps].fg}">${PERSONAS[ps].name}</span>`;
      return html;
    });

    // 存档：难度随档保存
    Game.saveExtras.push(() => ({ 'ai-diff': { attrs: { ...AI_ATTR }, ai: AI_COUNT, persona: personaMode } }));
    Game.loadExtras.push(sv => {
      const m = sv.mods && sv.mods['ai-diff'];
      const attrs = (m && m.attrs) || (GAME_MODE === 'ai' ? sv.attrs : null);
      if (attrs){
        Object.keys(AI_ATTR).forEach(k => {
          if (DIFF_LEVELS.includes(attrs[k])) AI_ATTR[k] = attrs[k];
        });
      }
      if (m && ['tycoon','renter','bully','mixed','off'].includes(m.persona)) personaMode = m.persona;
    });
  }

  // 开局播报难度
  Game.onStart.push(() => {
    if (GAME_MODE !== 'ai') return;
    const psList = players.map((p, pi) => p.isAI ? `${p.name}·${PERSONAS[personaOf(pi)] ? PERSONAS[personaOf(pi)].name : '无性格'}` : '').filter(Boolean);
    if (personaMode === 'off') log('🤖 AI 性格：已关闭（persona=off）');
    else if (personaMode === 'mixed') log(`🤖 AI 性格：${psList.join(' · ')}`);
    else log(`🤖 AI 性格：全员 ${PERSONAS[personaMode].name} —— ${PERSONAS[personaMode].desc}`);
    const o = aiOverall();
    if (o === 'custom'){
      log(`🤖 AI 自定义：${Object.keys(AI_ATTR).map(k => AI_ATTR_LABEL[k] + AI_DIFF_NAME[AI_ATTR[k]]).join(' · ')}`);
    } else {
      log(`🤖 AI 难度：${AI_DIFF_NAME[o]} —— ${AI_DIFF_DESC[o]}`);
    }
  });
});
