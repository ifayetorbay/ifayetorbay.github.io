// Heybe web köprüsü: claude.ai dışında (ifayetorbay.github.io) uygulamanın kullandığı window.claude.use(...)
// arayüzünü Supabase üstünde sağlar. Uygulama kodu (index.html) iki ortamda da aynı kalır.
//  - db:      trips/<tid>, entries/<id>, log/<id> → public.docs; data/users/<uid>/<id> → public.private_docs
//  - user:    hesapsız (anonim) Supabase girişi; kimlik bu tarayıcıda saklanır
//  - assets:  fiş fotoğrafları → "photos" kovası (tahmin edilemez dosya adı)
//  - receipt: fiş fotoğrafı → "fis-oku" Edge Function → Claude (yalnız üyeler, günlük kota; web/sql/fis-okuma.sql)
//  - words:   ortak sözlük → public.learned_words (yalnız learn_word / heybe_words işlevleriyle; web/sql/ortak-sozluk.sql)
// Seyahate davetle katılınır: ?katil=<tid>.<anahtar>. Güvenlik sunucudaki satır kurallarındadır (üye olmayan okuyamaz).
(function(){
  const URL0 = 'https://mongmlrsjvrbgfpxtrtv.supabase.co';
  const KEY = 'sb_publishable_1AtCWXttLuFVAzmfC5Ga6w_xyo-YXYo';
  const sb = window.supabase.createClient(URL0, KEY, {auth:{persistSession:true, autoRefreshToken:true, storageKey:'heybe-auth'}});
  const JOIN_KEY = 'heybe-katildi';

  async function signIn(){
    let {data:{session}} = await sb.auth.getSession();
    // Saklı oturum geçersizse (silinmiş ya da süresi dolmuş) yenisi açılır.
    if (session){ const {error} = await sb.auth.getUser(); if (error){ await sb.auth.signOut({scope:'local'}).catch(() => {}); session = null; } }
    if (!session){ const r = await sb.auth.signInAnonymously(); if (r.error) throw r.error; session = r.data.session; }
    return session.user.id;
  }
  // Davet bağlantısıyla gelindiyse seyahate üye olunur; adres çubuğundan anahtar silinir.
  async function start(){
    const uid = await signIn();
    const P = new URLSearchParams(location.search), q = P.get('katil') || P.get('kurucu');
    if (q){
      // kurucu: taşınan seyahatin tek kullanımlık kurucu bağlantısı
      const [t, k] = q.split('.');
      const {data, error} = P.get('kurucu') ? await sb.rpc('claim_trip', {t, k}) : await sb.rpc('join_trip', {t, k});
      if (!error && data) try { localStorage.setItem(JOIN_KEY, t); } catch(_) {}
      else window.__heybeJoinFailed = true;
      history.replaceState(null, '', location.pathname);
    }
    return uid;
  }
  const ready = start();
  ready.catch(e => console.warn('Heybe giriş', e));

  // ---- belgeler ----
  const COLLS = ['trips', 'entries', 'log'];
  const cache = {}, listeners = {}, timers = {};
  COLLS.forEach(c => { cache[c] = null; listeners[c] = []; });
  const snapOf = (map, changes) => ({
    docs:[...map.entries()].map(([id, data]) => ({id, data:() => data})),
    docChanges:() => changes
  });
  async function refresh(c){
    await ready;
    const {data, error} = await sb.from('docs').select('id,data').eq('coll', c);
    if (error){ listeners[c].forEach(l => l.err && l.err(error)); return; }
    const next = new Map(data.map(r => [r.id, r.data])), prev = cache[c] || new Map(), changes = [];
    for (const [id, d] of next){ const o = prev.get(id); if (!o) changes.push({type:'added', doc:{id, data:() => d}}); else if (JSON.stringify(o) !== JSON.stringify(d)) changes.push({type:'modified', doc:{id, data:() => d}}); }
    for (const [id, d] of prev) if (!next.has(id)) changes.push({type:'removed', doc:{id, data:() => d}});
    const first = !cache[c]; cache[c] = next;
    if (first || changes.length) listeners[c].forEach(l => l.cb(snapOf(next, changes)));
  }
  const soon = c => { clearTimeout(timers[c]); timers[c] = setTimeout(() => refresh(c), 250); };
  const refreshAll = () => COLLS.forEach(soon);
  ready.then(() => {
    sb.channel('heybe-docs').on('postgres_changes', {event:'*', schema:'public', table:'docs'}, p => {
      const c = (p.new && p.new.coll) || (p.old && p.old.coll); if (COLLS.includes(c)) soon(c); else refreshAll();
    }).subscribe();
    // Gerçek zamanlı bağlantı koparsa diye ara ara ve uygulamaya dönünce tazele.
    setInterval(refreshAll, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll(); });
  }).catch(() => {});

  const tripKeys = new Map();
  async function ensureTrip(tid){
    if (tripKeys.has(tid)) return tripKeys.get(tid);
    const {data, error} = await sb.rpc('create_trip', {t:tid}); if (error) throw error;
    tripKeys.set(tid, data); return data;
  }
  const parse = path => { const p = path.split('/'); return p[0] === 'data' && p[1] === 'users' ? {priv:true, id:p.slice(3).join('/')} : {coll:p[0], id:p.slice(1).join('/')}; };

  function doc(path){
    const P = parse(path);
    return {
      async get(){
        await ready;
        if (P.priv){ const {data, error} = await sb.from('private_docs').select('data').eq('id', P.id).maybeSingle(); if (error) throw error; return {exists:!!data, data:() => data && data.data}; }
        const {data, error} = await sb.from('docs').select('data').eq('coll', P.coll).eq('id', P.id).maybeSingle(); if (error) throw error;
        return {exists:!!data, data:() => data && data.data};
      },
      async set(d){
        const uid = await ready;
        if (P.priv){ const {error} = await sb.from('private_docs').upsert({uid, id:P.id, data:d, updated_at:new Date().toISOString()}); if (error) throw error; return; }
        if (!COLLS.includes(P.coll)) return;
        const trip = P.coll === 'trips' ? P.id : (d.tripId || 'main');
        if (P.coll === 'trips') await ensureTrip(P.id);
        const {error} = await sb.from('docs').upsert({coll:P.coll, id:P.id, trip_id:trip, data:d, updated_at:new Date().toISOString(), updated_by:uid}); if (error) throw error;
        soon(P.coll);
      },
      async delete(){
        await ready;
        if (P.priv){ await sb.from('private_docs').delete().eq('id', P.id); return; }
        const {error} = await sb.from('docs').delete().eq('coll', P.coll).eq('id', P.id); if (error) throw error;
        soon(P.coll);
      },
      // Web'de eski "ilk seyahat" belgesi (trip/meta) yoktur.
      onSnapshot(cb){ ready.then(() => cb({exists:false, data:() => undefined}), () => {}); return () => {}; }
    };
  }
  function collection(c){
    return {onSnapshot(cb, err){ const l = {cb, err}; listeners[c].push(l); if (cache[c]) cb(snapOf(cache[c], [...cache[c]].map(([id, d]) => ({type:'added', doc:{id, data:() => d}})))); else refresh(c); return () => { listeners[c] = listeners[c].filter(x => x !== l); }; }};
  }

  const caps = {
    db:{doc, collection},
    user:{id:() => ready, isOwner:async () => false},
    assets:{async upload(blob, o){
      await ready;
      const id = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)) + '.jpg';
      const {error} = await sb.storage.from('photos').upload(id, blob, {contentType:(o && o.type) || 'image/jpeg'}); if (error) throw error;
      return {id};
    }}
  };
  window.claude = {
    web:true,
    async use(name){
      if (!caps[name]) throw {code:'not_declared'};
      await ready;      // giriş olmazsa (ör. anonim giriş kapalı) bulut kapalı kalır, uygulama bu cihazda çalışır
      return caps[name];
    },
    photoUrl:id => `${URL0}/storage/v1/object/public/photos/${encodeURIComponent(id)}`,
    // Davet bağlantısı: seyahatin gizli anahtarıyla.
    async inviteLink(tid){ const k = await ensureTrip(tid); return `${location.origin}${location.pathname}?katil=${encodeURIComponent(tid)}.${k}`; },
    // Uygulama içinden yapıştırılan davet ya da kurucu bağlantısı (iPhone'da ana ekran uygulaması Safari'den ayrı hafıza kullanır).
    async joinWith(text){
      const m = String(text || '').match(/[?&](katil|kurucu)=([^&\s]+)/); if (!m) return {ok:false};
      const [t, k] = decodeURIComponent(m[2]).split('.');
      await ready;
      const {data, error} = m[1] === 'kurucu' ? await sb.rpc('claim_trip', {t, k}) : await sb.rpc('join_trip', {t, k});
      if (error || !data) return {ok:false, tid:t};
      refreshAll(); return {ok:true, tid:t};
    },
    // Ortak sözlük (fiş düzeltmelerinden öğrenilen kelimeler; ürün adı/fiyat değil). Sunucuda işlev yoksa boş döner.
    words:{
      async load(){ try { await ready; const {data, error} = await sb.rpc('heybe_words'); return error ? [] : data || []; } catch(_) { return []; } },
      async add(rows){ try { await ready; for (const r of rows) await sb.rpc('learn_word', {k:r.key, kd:r.kind, t:r.tr}); } catch(_) {} }
    },
    // Fiş okuma: fotoğraf "fis-oku" sunucu işleviyle Claude'a okutulur (web/functions/fis-oku). Kota dolduysa {code:'quota'}.
    async receipt(image, country, trip){
      await ready;
      const {data, error} = await sb.functions.invoke('fis-oku', {body:{image, country, trip}});
      if (error){ const st = error.context && error.context.status; throw {code:st === 429 ? 'quota' : 'cloud'}; }
      if (!data || data.error) throw {code:'cloud'};
      return data;
    },
    takeJoined(){ try { const t = localStorage.getItem(JOIN_KEY); localStorage.removeItem(JOIN_KEY); return t; } catch(_) { return null; } },
    joinFailed:() => !!window.__heybeJoinFailed
  };
})();
