// DEMO datu slānis — tie paši noteikumi kā Supabase datubāzē, bet dati glabājas šajā pārlūkā (localStorage).
// Paredzēts aplikācijas izmēģināšanai, pirms pieslēgta īstā datubāze.

const KEY = 'box_demo_v5';
const RULES_V1 = "1. BOX lieto tikai ar rezervāciju aplikācijā. Ja BOX ir brīvs, var iečekoties arī bez rezervācijas. Vienam dalībniekam vienlaikus var būt ne vairāk kā 2 rezervācijas.\n2. IEČEKOŠANĀS — ar QR kodu. Sākot darbu, aplikācijā noskenē QR kodu, kas piestiprināts BOX iekšpusē. To var izdarīt tikai uz vietas.\n3. IZČEKOŠANĀS — ar fotogrāfiju. Kad auto ir izbraukts un BOX ir tukšs un sakopts, aplikācijā nofotografē BOX telpu. Tiklīdz foto ir uzņemts, izčekošanās notiek automātiski. Bez foto izčekoties nevar.\n4. Foto redz admins un nākamais lietotājs — lai būtu skaidrs, kādā kārtībā un tīrībā BOX ir atstāts. Fotografē pats, uz vietas, ar aplikācijas kameru. Cita atsūtītu bildi izmantot nevar.\n5. Maksa ir 2 € stundā. Mazākā maksa ir par 1 stundu, tālāk laiku skaita pa 30 minūtēm: līdz 15 minūtēm noapaļo uz leju, vairāk — uz augšu. Piemēri: 1 h 15 min = 1 h; 1 h 20 min = 1 h 30 min; 1 h 47 min = 2 h.\n6. Ja aizbrauc neizčekojies, laiks turpina skaitīties, un tas izmaksās dārgi. Atgriezies un nofotografē tukšu BOX vai uzreiz sazinies ar adminu. Aplikācijas brīdinājums ir tikai palīgs — par izčekošanos atbild pats lietotājs.\n7. Ja atrodi BOX aizņemtu ar cita auto, nospied \"BOX nav atbrīvots\". Iepriekšējam lietotājam laiks tiks skaitīts tālāk.\n8. Ja BOX vajag ilgāk nekā parasti (avārija, sarežģīts remonts), sarunā to ar adminu. Admins uzliek HOLD, un to redz visi.\n9. Ja kaut kas ir salūzis vai trūkst, uzreiz ziņo par to aplikācijā.\n10. Katra mēneša 1. datumā tiek saskaitīts, cik katrs ir lietojis. Savu uzkrāto summu katrs redz aplikācijā.\n11. Uzkrāto summu dzēš ar papildu darbiem ārpus darba laika (piemēram, granulu papildināšana, lapu vai sniega tīrīšana) vai ar naudu. Par katru darbu un tā summu iepriekš vienojas ar adminu.\n12. Ja uzkrāto summu nenokārto, admins var slēgt piekļuvi BOX.\n13. Nauda tiek tērēta tikai BOX uzturēšanai un instrumentiem. Kasi redz visi.\n14. Pacēlāju lieto tikai tas, kurš prot ar to droši strādāt. Par savu drošību un nodarītiem bojājumiem atbild pats lietotājs.\n15. BOX kodu nedod citiem. BOX lieto tikai grupas dalībnieki.\n16. Strīdus izšķir admins. Par noteikumu pārkāpšanu admins var slēgt piekļuvi.";
const PHOTO_KEEP = 12; // demo režīmā glabā tikai pēdējos foto (pārlūka atmiņa ir maza)
const MIN = 60000;

function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2)); }
function code(n = 6) { return Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join(''); }
function iso(d) { return new Date(d).toISOString(); }
function round2(x) { return Math.round(x * 100) / 100; }
// Aprēķina laiks: minimums, tālāk pa soļiem (30 min); atlikumu līdz 15 min noapaļo uz leju, vairāk — uz augšu
export function billMinutes(m, st) {
  const step = +st.bill_step_minutes || 0, min = +st.min_minutes || 0;
  if (step <= 0) return Math.max(m, min);
  const r = m % step, base = m - r;
  return Math.max(r <= (+st.bill_round_down_minutes || 0) ? base : base + step, min);
}
function distanceM(lat1, lng1, lat2, lng2) {
  const r = x => x * Math.PI / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

function seed() {
  const names = [
    ['Aras Noreika', 'admin', 'Admin auto'],
    ['Aivars Irbe', 'member', ''], ['Aivars Šteins', 'member', ''], ['Andris Freibergs', 'member', ''],
    ['Ilvars Garancs', 'member', ''], ['Klāvs Snikeris', 'member', ''], ['Māris Noreika', 'member', ''],
    ['Roberts Bisenieks', 'member', ''], ['Sasha', 'member', ''],
  ];
  const profiles = names.map(([full_name, role, car]) => ({ id: uuid(), full_name, role, car, phone: '', active: true, created_at: iso(Date.now()) }));
  const P = n => profiles.find(p => p.full_name.startsWith(n)).id;
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const at = (d, h, m = 0) => iso(new Date(day.getTime() + d * 86400000 + (h * 60 + m) * MIN));
  let bid = 1, sid = 1;
  const bookings = [
    { id: bid++, user_id: P('Roberts'), starts_at: at(-3, 17), ends_at: at(-3, 19, 30), status: 'completed', note: 'Bremžu kluči' },
    { id: bid++, user_id: P('Māris'), starts_at: at(-2, 9), ends_at: at(-2, 12), status: 'completed', note: 'Eļļas maiņa' },
    { id: bid++, user_id: P('Andris'), starts_at: at(1, 10), ends_at: at(1, 13), status: 'active', note: 'Riepu maiņa' },
    { id: bid++, user_id: P('Klāvs'), starts_at: at(2, 16), ends_at: at(2, 20), status: 'active', note: '' },
    { id: bid++, user_id: P('Ilvars'), starts_at: at(4, 8), ends_at: at(4, 11), status: 'active', note: 'Izplūdes sistēma' },
  ];
  const sessions = [
    { id: sid++, user_id: P('Roberts'), booking_id: 1, checked_in_at: at(-3, 17, 5), checked_out_at: at(-3, 19, 20), minutes: 135, billed_minutes: 120, amount: 4.0 },
    { id: sid++, user_id: P('Māris'), booking_id: 2, checked_in_at: at(-2, 9, 0), checked_out_at: at(-2, 9, 40), minutes: 40, billed_minutes: 60, amount: 2.0 },
  ];
  return {
    settings: { id: 1, hourly_rate: 2, min_minutes: 60, checkin_early_minutes: 15, walkin_minutes: 60, checkin_code: 'DEMO42', noshow_enabled: false, noshow_minutes: 30,
      geo_enabled: true, box_lat: 56.990484, box_lng: 24.185431, geo_radius_m: 250,
      bill_step_minutes: 30, bill_round_down_minutes: 15, photo_required: true, max_active_bookings: 2, debt_warn_eur: 30 },
    profiles, invites: [], bookings, sessions, ledger: [], cash: [
      { id: 1, entry_date: at(-10, 0).slice(0, 10), direction: 'out', category: 'instrumenti', amount: 39.9, description: 'Dinamometriskā atslēga (piemērs)' },
    ],
    devices: [
      { id: 1, kind: 'shelly_lift', name: 'Pacēlāja HOFMANN barošana', location: 'Elektrības sadalne', enabled: false },
      { id: 2, kind: 'camera', name: 'Kamera 1', location: 'BOX kreisā puse', enabled: false },
      { id: 3, kind: 'camera', name: 'Kamera 2', location: 'BOX labā puse', enabled: false },
    ],
    reports: [],
    rules: [{ version: 1, body: RULES_V1, published_at: iso(Date.now()) }], acceptances: [], holds: [], issues: [],
    seq: { booking: bid, session: sid, ledger: 1, cash: 2, report: 1, hold: 1, issue: 1 },
    currentUser: null,
  };
}

export function createDemoApi() {
  let db = JSON.parse(localStorage.getItem(KEY) || 'null') || seed();
  const save = () => localStorage.setItem(KEY, JSON.stringify(db));
  save();
  const me = () => db.profiles.find(p => p.id === db.currentUser) || null;
  const isAdmin = () => me()?.role === 'admin' && me()?.active;
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };
  const live = b => b.status === 'active' || b.status === 'completed';
  const overlaps = (s, e, exceptId) => db.bookings.some(b => live(b) && b.id !== exceptId &&
    new Date(b.starts_at) < new Date(e) && new Date(b.ends_at) > new Date(s));
  const name = id => db.profiles.find(p => p.id === id)?.full_name || '?';
  const curRules = () => db.rules[db.rules.length - 1];
  const accepted = id => db.acceptances.find(a => a.user_id === id && a.version === curRules().version);
  const okUser = () => !!(me()?.active && accepted(me().id));
  const NOT_OK = 'Konts nav aktivizēts vai nav apstiprināti BOX noteikumi';
  const openHold = () => db.holds.find(h => !h.ended_at);
  const cancelForHold = end => db.bookings.filter(b => b.status === 'active' && new Date(b.starts_at) < new Date(end) && new Date(b.ends_at) > Date.now())
    .forEach(b => { b.status = 'cancelled'; b.note = ((b.note || '') + ' (atcelts: HOLD)').trim(); });
  const closeSession = (s, now, extra = {}) => {
    const st = db.settings, m = Math.max(1, Math.floor((now - new Date(s.checked_in_at)) / MIN)), bill = billMinutes(m, st);
    Object.assign(s, { checked_out_at: iso(now), minutes: m, billed_minutes: bill, amount: round2(bill / 60 * st.hourly_rate), ...extra });
    const b = db.bookings.find(x => x.id === s.booking_id);
    if (b) { b.status = 'completed'; if (new Date(b.ends_at) > now) b.ends_at = iso(Math.max(now, new Date(b.starts_at).getTime() + 1000)); }
    db.reports.filter(x => x.session_id === s.id && x.status === 'open').forEach(x => { x.status = 'resolved'; x.resolved_at = iso(now); });
  };
  const prunePhotos = () => db.sessions.filter(s => s.photo).sort((a, b) => (b.checked_out_at || '9').localeCompare(a.checked_out_at || '9'))
    .slice(PHOTO_KEEP).forEach(s => { s.photo = null; s.photo_pruned = true; });
  // Sesijas, kas vēl nav pārnestas uz kontu (mēnesis nav slēgts)
  const pendingOf = uid => round2(db.sessions.filter(s => s.user_id === uid && s.checked_out_at).filter(s => {
    const d = new Date(s.checked_out_at), period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    return !db.ledger.some(l => l.user_id === uid && l.kind === 'usage' && l.period === period);
  }).reduce((a, s) => a + s.amount, 0));
  const geoCheck = pos => {
    const st = db.settings;
    if (!st.geo_enabled) return;
    need(pos && pos.lat != null && pos.lng != null, 'Nav zināma tava atrašanās vieta — atļauj aplikācijai piekļuvi atrašanās vietai');
    const d = distanceM(pos.lat, pos.lng, st.box_lat, st.box_lng);
    need(d <= st.geo_radius_m + Math.min(pos.acc || 0, 100),
      `Tu neesi pie BOX (attālums ~${d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'}, atļauts ${st.geo_radius_m} m)`);
  };

  return {
    demo: true,
    demoUsers: () => db.profiles.map(p => ({ id: p.id, full_name: p.full_name, role: p.role })),
    demoLogin(id) { db.currentUser = id; save(); },
    demoReset() { localStorage.removeItem(KEY); db = seed(); save(); },

    async getSession() { const p = me(); return p ? { userId: p.id, profile: { ...p } } : null; },
    async signIn() { throw new Error('Demo režīmā izvēlies lietotāju no saraksta'); },
    async signUp({ full_name, phone, car, invite_code }) {
      const inv = db.invites.find(i => i.code === (invite_code || '').trim().toUpperCase() && !i.used_by);
      const p = { id: uuid(), full_name, phone, car, role: 'member', active: !!inv, created_at: iso(Date.now()) };
      db.profiles.push(p);
      if (inv) { inv.used_by = p.id; inv.used_at = iso(Date.now()); }
      db.currentUser = p.id; save();
    },
    async resetPassword() {},
    async signOut() { db.currentUser = null; save(); },
    async updateMyProfile(patch) { Object.assign(me(), { full_name: patch.full_name, phone: patch.phone, car: patch.car }); save(); },

    async getSettings() { const { checkin_code, ...rest } = db.settings; return rest; },
    async getAdminSettings() { need(isAdmin(), 'Nav tiesību'); return { ...db.settings }; },
    async updateSettings(patch) { need(isAdmin(), 'Nav tiesību'); Object.assign(db.settings, patch); save(); },

    async listBookings(fromIso, toIso) {
      need(okUser(), NOT_OK);
      return db.bookings.filter(b => live(b) && new Date(b.starts_at) < new Date(toIso) && new Date(b.ends_at) > new Date(fromIso))
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map(b => ({ ...b, full_name: name(b.user_id) }));
    },
    async createBooking(s, e, note) {
      need(okUser(), NOT_OK);
      need(new Date(e) > new Date(s), 'Beigu laikam jābūt pēc sākuma');
      need(new Date(s) > Date.now() - 10 * MIN, 'Nevar rezervēt pagātnē');
      need(!db.holds.some(h => !h.ended_at && new Date(s) < Math.max(new Date(h.expected_end), Date.now()) && new Date(e) > new Date(h.starts_at)),
        'Šajā laikā BOX ir uz HOLD — rezervē laiku pēc tā');
      need(!overlaps(s, e), 'Šis laiks jau ir aizņemts');
      const lim = +db.settings.max_active_bookings || 0;
      need(!lim || db.bookings.filter(x => x.user_id === me().id && x.status === 'active' && new Date(x.ends_at) > Date.now()
        && !db.sessions.some(z => z.booking_id === x.id)).length < lim, `Tev jau ir ${lim} aktīvas rezervācijas — vispirms izmanto vai atcel kādu no tām`);
      const b = { id: db.seq.booking++, user_id: me().id, starts_at: iso(s), ends_at: iso(e), status: 'active', note: note || '' };
      db.bookings.push(b); save(); return b;
    },
    async cancelBooking(id) {
      const b = db.bookings.find(x => x.id === id); need(b, 'Rezervācija nav atrasta');
      need(b.user_id === me().id || isAdmin(), 'Nav tiesību');
      need(!db.sessions.some(s => s.booking_id === id), 'Rezervācija jau izmantota — izčekojies');
      b.status = 'cancelled'; save();
    },

    async boxStatus() {
      const s = db.sessions.find(x => !x.checked_out_at); if (!s) return null;
      const b = db.bookings.find(x => x.id === s.booking_id); const p = db.profiles.find(x => x.id === s.user_id);
      const rep = db.reports.find(x => x.session_id === s.id && x.status === 'open');
      return { session_id: s.id, user_id: s.user_id, full_name: p?.full_name, car: p?.car, checked_in_at: s.checked_in_at, booking_ends: b?.ends_at,
        reported_by: rep ? name(rep.reporter_id) : null, reported_at: rep?.created_at || null };
    },
    async checkIn(c, pos = null) {
      const st = db.settings, now = Date.now();
      need(okUser(), NOT_OK);
      need((c || '').trim().toUpperCase() === st.checkin_code, 'Nepareizs BOX kods');
      geoCheck(pos);
      need(!openHold(), 'BOX ir uz HOLD — iečekoties nevar');
      need(!db.sessions.some(s => !s.checked_out_at), 'BOX šobrīd jau ir aizņemts');
      let b = db.bookings.filter(x => x.user_id === me().id && x.status === 'active' &&
        now >= new Date(x.starts_at) - st.checkin_early_minutes * MIN && now < new Date(x.ends_at))
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
      if (b) {
        if (new Date(b.starts_at) > now && !overlaps(iso(now), b.ends_at, b.id)) b.starts_at = iso(now);
      } else {
        const e = iso(now + st.walkin_minutes * MIN);
        need(!overlaps(iso(now), e), 'BOX tuvākajā laikā ir rezervēts citam — rezervē brīvu laiku kalendārā');
        b = { id: db.seq.booking++, user_id: me().id, starts_at: iso(now), ends_at: e, status: 'active', note: 'Iečekošanās bez rezervācijas' };
        db.bookings.push(b);
      }
      const s = { id: db.seq.session++, user_id: me().id, booking_id: b.id, checked_in_at: iso(now), checked_out_at: null };
      db.sessions.push(s); save(); return s;
    },
    async checkOut(sessionId = null, pos = null, photo = null) {
      const st = db.settings, now = Date.now();
      const s = sessionId ? db.sessions.find(x => x.id === sessionId && !x.checked_out_at)
        : db.sessions.find(x => x.user_id === me().id && !x.checked_out_at);
      need(s, 'Nav atvērtas sesijas');
      const own = s.user_id === me().id;
      need(own || isAdmin(), 'Nav tiesību');
      if (own) {
        geoCheck(pos);
        need(!st.photo_required || (typeof photo === 'string' && photo.startsWith('data:image/')), 'Vispirms nofotografē sakoptu BOX — bez foto izčekoties nevar');
      }
      closeSession(s, now, { closed_by: own ? null : me().id, photo: own ? photo || null : null });
      prunePhotos();
      try { save(); } catch (e) { s.photo = null; save(); }
      const { photo: _p, ...rest } = s; return rest;
    },
    // Pēdējā pabeigtā lietošana un tās foto — lai nākamais redz, kādu BOX atstāja iepriekšējais
    async lastCheckout() {
      need(okUser(), NOT_OK);
      const s = db.sessions.filter(x => x.checked_out_at).sort((a, b) => b.checked_out_at.localeCompare(a.checked_out_at))[0];
      return s ? { session_id: s.id, user_id: s.user_id, full_name: name(s.user_id), checked_out_at: s.checked_out_at, photo_url: s.photo || null, by_admin: !!s.closed_by } : null;
    },
    async sessionPhoto(sessionId) {
      const s = db.sessions.find(x => x.id === sessionId); need(s && (isAdmin() || okUser()), 'Nav tiesību');
      return s.photo || null;
    },
    async reportNotVacated(pos = null, note = null) {
      need(okUser(), NOT_OK);
      geoCheck(pos);
      need(!openHold(), 'BOX ir uz HOLD — ziņot nav vajadzības');
      need(!db.sessions.some(s => !s.checked_out_at), 'BOX šobrīd ir iečekots — ziņot nav vajadzības');
      const s = [...db.sessions].sort((a, b) => b.checked_out_at.localeCompare(a.checked_out_at))[0];
      need(s, 'Nav neviena iepriekšējā lietotāja');
      need(s.user_id !== me().id, 'Pēdējais lietotājs esi tu pats — ja tavs auto vēl ir BOX, iečekojies no jauna');
      need(new Date(s.checked_out_at) > Date.now() - 14 * 86400000, 'Pēdējā lietošana bija pirms vairāk nekā 14 dienām — sazinies ar administratoru');
      const d = new Date(s.checked_out_at); const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      need(!db.ledger.some(l => l.user_id === s.user_id && l.kind === 'usage' && l.period === period), 'Šis mēnesis jau ir slēgts — sazinies ar administratoru');
      need(!db.reports.some(x => x.session_id === s.id && x.status === 'rejected'), 'Ziņojums par šo reizi jau tika noraidīts — sazinies ar administratoru');
      db.reports.push({ id: db.seq.report++, session_id: s.id, reporter_id: me().id, note, status: 'open', created_at: iso(Date.now()),
        prev_checked_out_at: s.checked_out_at, prev_minutes: s.minutes, prev_billed_minutes: s.billed_minutes, prev_amount: s.amount, prev_closed_by: s.closed_by || null });
      Object.assign(s, { checked_out_at: null, minutes: null, billed_minutes: null, amount: null, closed_by: null });
      const p = db.profiles.find(x => x.id === s.user_id);
      save(); return { full_name: p.full_name, phone: p.phone, checked_in_at: s.checked_in_at };
    },
    async rejectReport(id) {
      need(isAdmin(), 'Nav tiesību');
      const r = db.reports.find(x => x.id === id); need(r, 'Ziņojums nav atrasts');
      need(r.status !== 'rejected', 'Ziņojums jau ir noraidīts');
      const s = db.sessions.find(x => x.id === r.session_id);
      Object.assign(s, { checked_out_at: r.prev_checked_out_at, minutes: r.prev_minutes, billed_minutes: r.prev_billed_minutes, amount: r.prev_amount, closed_by: r.prev_closed_by });
      Object.assign(r, { status: 'rejected', resolved_by: me().id, resolved_at: iso(Date.now()) });
      save();
    },
    async listReports() {
      need(isAdmin(), 'Nav tiesību');
      return [...db.reports].reverse().map(r => { const s = db.sessions.find(x => x.id === r.session_id);
        return { id: r.id, created_at: r.created_at, status: r.status, note: r.note, reporter_name: name(r.reporter_id), user_name: name(s.user_id),
          checked_in_at: s.checked_in_at, prev_checked_out_at: r.prev_checked_out_at, prev_amount: r.prev_amount }; });
    },

    async mySessions() { return db.sessions.filter(s => s.user_id === me().id).sort((a, b) => b.checked_in_at.localeCompare(a.checked_in_at)).map(({ photo, ...s }) => ({ ...s, has_photo: !!photo })); },
    async myLedger() { return db.ledger.filter(l => l.user_id === me().id).sort((a, b) => b.created_at.localeCompare(a.created_at)); },

    async listCash() { return [...db.cash].sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.id - a.id); },
    async addCash(e) { need(isAdmin(), 'Nav tiesību'); db.cash.push({ id: db.seq.cash++, ...e, created_by: me().id }); save(); },
    async deleteCash(id) { need(isAdmin(), 'Nav tiesību'); db.cash = db.cash.filter(c => c.id !== id); save(); },

    async listProfiles() { return [...db.profiles].sort((a, b) => a.full_name.localeCompare(b.full_name)); },
    async updateProfile(id, patch) { need(isAdmin(), 'Nav tiesību'); Object.assign(db.profiles.find(p => p.id === id), patch); save(); },
    async removeMember(id) {
      need(isAdmin(), 'Nav tiesību'); need(id !== me().id, 'Sevi izslēgt nevar');
      const p = db.profiles.find(x => x.id === id); need(p, 'Dalībnieks nav atrasts');
      need(!db.sessions.some(s => s.user_id === id && !s.checked_out_at), 'Dalībnieks šobrīd ir iečekots BOX — vispirms izčeko viņu');
      need(!db.holds.some(h => h.user_id === id && !h.ended_at), 'Dalībniekam ir aktīvs HOLD — vispirms beidz to');
      db.bookings.filter(b => b.user_id === id && b.status === 'active').forEach(b => { b.status = 'cancelled'; b.note = ((b.note || '') + ' (atcelts: dalība beigusies)').trim(); });
      Object.assign(p, { active: false, role: 'member', removed_at: iso(Date.now()) }); save();
    },
    async restoreMember(id) {
      need(isAdmin(), 'Nav tiesību');
      const p = db.profiles.find(x => x.id === id && x.removed_at); need(p, 'Dalībnieks nav izslēgts');
      Object.assign(p, { active: true, removed_at: null }); save();
    },
    async listInvites() { return db.invites.map(i => ({ ...i, used: i.used_by ? { full_name: name(i.used_by) } : null })).reverse(); },
    async createInvite(note, phone = null) { need(isAdmin(), 'Nav tiesību'); const i = { code: code(8), note, phone: phone || null, created_at: iso(Date.now()) }; db.invites.push(i); save(); return i; },
    async deleteInvite(c) { db.invites = db.invites.filter(i => i.code !== c); save(); },
    async listSessions(f, t) {
      return db.sessions.filter(s => s.checked_out_at && s.checked_out_at >= f && s.checked_out_at < t).sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at)).map(({ photo, ...s }) => ({ ...s, has_photo: !!photo, full_name: name(s.user_id) }));
    },
    async balances() {
      return db.profiles.filter(p => isAdmin() || p.id === me().id).map(p => ({ user_id: p.id, full_name: p.full_name,
        balance: round2(db.ledger.filter(l => l.user_id === p.id).reduce((a, l) => a + l.amount, 0)), pending: pendingOf(p.id) })).sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
    async listLedgerAll() { return [...db.ledger].reverse().map(l => ({ ...l, full_name: name(l.user_id) })); },
    async recordPayment(userId, kind, amount, description, hours) {
      need(isAdmin(), 'Nav tiesību'); need(amount, 'Summa nevar būt 0');
      db.ledger.push({ id: db.seq.ledger++, user_id: userId, kind, hours: hours ?? null, amount: kind === 'adjustment' ? amount : -Math.abs(amount), description, created_at: iso(Date.now()) });
      if (kind === 'cash') db.cash.push({ id: db.seq.cash++, entry_date: iso(Date.now()).slice(0, 10), direction: 'in', category: 'iemaksa', amount: Math.abs(amount), description: description || 'Iemaksa' });
      save();
    },
    async closeMonth(monthDate) {
      need(isAdmin(), 'Nav tiesību');
      const d = new Date(monthDate + 'T00:00:00'); const f = new Date(d.getFullYear(), d.getMonth(), 1); const t = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const period = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-01`;
      const by = {};
      db.sessions.filter(s => s.checked_out_at && new Date(s.checked_out_at) >= f && new Date(s.checked_out_at) < t)
        .forEach(s => { (by[s.user_id] ||= { min: 0, amt: 0, n: 0 }); by[s.user_id].min += s.billed_minutes; by[s.user_id].amt += s.amount; by[s.user_id].n++; });
      let n = 0;
      for (const [uid, v] of Object.entries(by)) {
        if (db.ledger.some(l => l.user_id === uid && l.kind === 'usage' && l.period === period)) continue;
        db.ledger.push({ id: db.seq.ledger++, user_id: uid, kind: 'usage', period, hours: round2(v.min / 60), amount: round2(v.amt),
          description: `BOX lietošana ${period.slice(0, 7)} (${v.n} reizes)`, created_at: iso(Date.now()) });
        n++;
      }
      save(); return n;
    },
    // ---------- noteikumi ----------
    async rulesStatus() {
      const r = curRules(), a = me() && accepted(me().id);
      return { version: r.version, body: r.body, published_at: r.published_at, accepted: !!a, accepted_at: a?.accepted_at || null };
    },
    async acceptRules(version) {
      need(me()?.active, 'Konts nav aktivizēts');
      need(version === curRules().version, 'Noteikumi ir mainīti — atver aplikāciju no jauna');
      if (!accepted(me().id)) db.acceptances.push({ user_id: me().id, version, accepted_at: iso(Date.now()) });
      save();
    },
    async publishRules(body) {
      need(isAdmin(), 'Nav tiesību'); need((body || '').trim().length >= 20, 'Noteikumu teksts ir par īsu');
      const v = curRules().version + 1;
      db.rules.push({ version: v, body: body.trim(), published_at: iso(Date.now()), published_by: me().id }); save(); return v;
    },
    async listRuleAcceptances() {
      need(isAdmin(), 'Nav tiesību');
      return db.profiles.filter(p => p.active).map(p => ({ user_id: p.id, full_name: p.full_name, accepted_at: accepted(p.id)?.accepted_at || null }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
    },

    // ---------- HOLD ----------
    async boxHold() {
      const h = openHold(); if (!h) return null;
      const p = db.profiles.find(x => x.id === h.user_id);
      return { id: h.id, user_id: h.user_id, full_name: p?.full_name, phone: p?.phone, starts_at: h.starts_at, expected_end: h.expected_end, reason: h.reason };
    },
    async listHolds() {
      return [...db.holds].reverse().map(h => { const p = db.profiles.find(x => x.id === h.user_id); return { ...h, full_name: p?.full_name || '?', phone: p?.phone || '' }; });
    },
    async startHold(userId, expectedEndIso, reason) {
      need(isAdmin(), 'Nav tiesību'); const now = Date.now();
      need(new Date(expectedEndIso) > now, 'Beigu laikam jābūt nākotnē');
      need(db.profiles.some(p => p.id === userId && p.active), 'Lietotājs nav atrasts');
      need(!openHold(), 'HOLD jau ir aktīvs — vispirms beidz esošo');
      const s = db.sessions.find(x => !x.checked_out_at);
      if (s) {
        need(s.user_id === userId, 'BOX šobrīd lieto cits lietotājs — vispirms izčeko viņu');
        closeSession(s, now, { closed_by: me().id, note: 'Noslēgts, uzliekot HOLD' });
      }
      cancelForHold(expectedEndIso);
      const h = { id: db.seq.hold++, user_id: userId, starts_at: iso(now), expected_end: iso(expectedEndIso), ended_at: null,
        reason: (reason || '').trim() || null, amount: null, created_by: me().id };
      db.holds.push(h); save(); return { ...h };
    },
    async updateHold(id, expectedEndIso, reason) {
      need(isAdmin(), 'Nav tiesību'); need(new Date(expectedEndIso) > Date.now(), 'Beigu laikam jābūt nākotnē');
      const h = db.holds.find(x => x.id === id && !x.ended_at); need(h, 'HOLD nav atrasts vai jau ir beidzies');
      h.expected_end = iso(expectedEndIso); if ((reason || '').trim()) h.reason = reason.trim();
      cancelForHold(expectedEndIso); save(); return { ...h };
    },
    async endHold(id, amount, note) {
      need(isAdmin(), 'Nav tiesību'); need(!(amount < 0), 'Summa nevar būt negatīva');
      const h = db.holds.find(x => x.id === id && !x.ended_at); need(h, 'HOLD nav atrasts vai jau ir beidzies');
      const now = new Date(), d = x => { x = new Date(x); return String(x.getDate()).padStart(2, '0') + '.' + String(x.getMonth() + 1).padStart(2, '0') + '.'; };
      Object.assign(h, { ended_at: iso(now), ended_by: me().id, amount: amount || 0 });
      if (amount > 0) db.ledger.push({ id: db.seq.ledger++, user_id: h.user_id, kind: 'hold', hours: null, amount: round2(amount),
        description: `HOLD ${d(h.starts_at)}–${d(now)}${now.getFullYear()}` + ((note || '').trim() ? ': ' + note.trim() : h.reason ? ': ' + h.reason : ''), created_at: iso(now) });
      save(); return { ...h };
    },

    // ---------- bojājumu žurnāls ----------
    async listIssues() {
      need(okUser(), NOT_OK);
      return [...db.issues].reverse().map(i => ({ ...i, full_name: name(i.user_id) }));
    },
    async addIssue(text) {
      need(okUser(), NOT_OK); need((text || '').trim().length >= 3, 'Apraksti, kas ir salūzis vai trūkst');
      db.issues.push({ id: db.seq.issue++, user_id: me().id, body: text.trim().slice(0, 300), status: 'open', created_at: iso(Date.now()), resolved_at: null, resolution: null }); save();
    },
    async resolveIssue(id, note) {
      need(isAdmin(), 'Nav tiesību'); const i = db.issues.find(x => x.id === id && x.status === 'open'); need(i, 'Ieraksts nav atrasts');
      Object.assign(i, { status: 'done', resolved_at: iso(Date.now()), resolved_by: me().id, resolution: (note || '').trim() || null }); save();
    },

    async listDevices() { return db.devices; },
  };
}
