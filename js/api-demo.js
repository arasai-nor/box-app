// DEMO datu slānis — tie paši noteikumi kā Supabase datubāzē, bet dati glabājas šajā pārlūkā (localStorage).
// Paredzēts aplikācijas izmēģināšanai, pirms pieslēgta īstā datubāze.

const KEY = 'box_demo_v1';
const MIN = 60000;

function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2)); }
function code(n = 6) { return Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join(''); }
function iso(d) { return new Date(d).toISOString(); }
function round2(x) { return Math.round(x * 100) / 100; }

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
    { id: sid++, user_id: P('Roberts'), booking_id: 1, checked_in_at: at(-3, 17, 5), checked_out_at: at(-3, 19, 20), minutes: 135, billed_minutes: 135, amount: 4.5 },
    { id: sid++, user_id: P('Māris'), booking_id: 2, checked_in_at: at(-2, 9, 0), checked_out_at: at(-2, 9, 40), minutes: 40, billed_minutes: 60, amount: 2.0 },
  ];
  return {
    settings: { id: 1, hourly_rate: 2, min_minutes: 60, checkin_early_minutes: 15, walkin_minutes: 60, checkin_code: 'DEMO42', noshow_enabled: false, noshow_minutes: 30 },
    profiles, invites: [], bookings, sessions, ledger: [], cash: [
      { id: 1, entry_date: at(-10, 0).slice(0, 10), direction: 'out', category: 'instrumenti', amount: 39.9, description: 'Dinamometriskā atslēga (piemērs)' },
    ],
    devices: [
      { id: 1, kind: 'shelly_lift', name: 'Pacēlāja HOFMANN barošana', location: 'Elektrības sadalne', enabled: false },
      { id: 2, kind: 'camera', name: 'Kamera 1', location: 'BOX kreisā puse', enabled: false },
      { id: 3, kind: 'camera', name: 'Kamera 2', location: 'BOX labā puse', enabled: false },
    ],
    seq: { booking: bid, session: sid, ledger: 1, cash: 2 },
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
      need(me()?.active, 'Konts nav aktivizēts');
      return db.bookings.filter(b => live(b) && new Date(b.starts_at) < new Date(toIso) && new Date(b.ends_at) > new Date(fromIso))
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map(b => ({ ...b, full_name: name(b.user_id) }));
    },
    async createBooking(s, e, note) {
      need(me()?.active, 'Konts nav aktivizēts');
      need(new Date(e) > new Date(s), 'Beigu laikam jābūt pēc sākuma');
      need(new Date(s) > Date.now() - 10 * MIN, 'Nevar rezervēt pagātnē');
      need(!overlaps(s, e), 'Šis laiks jau ir aizņemts');
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
      return { session_id: s.id, user_id: s.user_id, full_name: p?.full_name, car: p?.car, checked_in_at: s.checked_in_at, booking_ends: b?.ends_at };
    },
    async checkIn(c) {
      const st = db.settings, now = Date.now();
      need(me()?.active, 'Konts nav aktivizēts');
      need((c || '').trim().toUpperCase() === st.checkin_code, 'Nepareizs BOX kods');
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
    async checkOut(sessionId = null) {
      const st = db.settings, now = Date.now();
      const s = sessionId ? db.sessions.find(x => x.id === sessionId && !x.checked_out_at)
        : db.sessions.find(x => x.user_id === me().id && !x.checked_out_at);
      need(s, 'Nav atvērtas sesijas');
      need(s.user_id === me().id || isAdmin(), 'Nav tiesību');
      const m = Math.max(1, Math.ceil((now - new Date(s.checked_in_at)) / MIN));
      const bill = Math.max(m, st.min_minutes);
      Object.assign(s, { checked_out_at: iso(now), minutes: m, billed_minutes: bill, amount: round2(bill / 60 * st.hourly_rate), closed_by: s.user_id !== me().id ? me().id : null });
      const b = db.bookings.find(x => x.id === s.booking_id);
      if (b) { b.status = 'completed'; if (new Date(b.ends_at) > now) b.ends_at = iso(Math.max(now, new Date(b.starts_at).getTime() + MIN)); }
      save(); return { ...s };
    },

    async mySessions() { return db.sessions.filter(s => s.user_id === me().id).sort((a, b) => b.checked_in_at.localeCompare(a.checked_in_at)); },
    async myLedger() { return db.ledger.filter(l => l.user_id === me().id).sort((a, b) => b.created_at.localeCompare(a.created_at)); },

    async listCash() { return [...db.cash].sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.id - a.id); },
    async addCash(e) { need(isAdmin(), 'Nav tiesību'); db.cash.push({ id: db.seq.cash++, ...e, created_by: me().id }); save(); },
    async deleteCash(id) { need(isAdmin(), 'Nav tiesību'); db.cash = db.cash.filter(c => c.id !== id); save(); },

    async listProfiles() { return [...db.profiles].sort((a, b) => a.full_name.localeCompare(b.full_name)); },
    async updateProfile(id, patch) { need(isAdmin(), 'Nav tiesību'); Object.assign(db.profiles.find(p => p.id === id), patch); save(); },
    async listInvites() { return db.invites.map(i => ({ ...i, used: i.used_by ? { full_name: name(i.used_by) } : null })).reverse(); },
    async createInvite(note) { need(isAdmin(), 'Nav tiesību'); const i = { code: code(8), note, created_at: iso(Date.now()) }; db.invites.push(i); save(); return i; },
    async deleteInvite(c) { db.invites = db.invites.filter(i => i.code !== c); save(); },
    async listSessions(f, t) {
      return db.sessions.filter(s => s.checked_in_at >= f && s.checked_in_at < t).sort((a, b) => a.checked_in_at.localeCompare(b.checked_in_at)).map(s => ({ ...s, full_name: name(s.user_id) }));
    },
    async balances() {
      return db.profiles.filter(p => isAdmin() || p.id === me().id).map(p => ({ user_id: p.id, full_name: p.full_name,
        balance: round2(db.ledger.filter(l => l.user_id === p.id).reduce((a, l) => a + l.amount, 0)) })).sort((a, b) => a.full_name.localeCompare(b.full_name));
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
      db.sessions.filter(s => s.checked_out_at && new Date(s.checked_in_at) >= f && new Date(s.checked_in_at) < t)
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
    async listDevices() { return db.devices; },
  };
}
