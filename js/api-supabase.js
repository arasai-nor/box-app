// Supabase datu slānis (produkcija)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export function createSupabaseApi(cfg) {
  const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

  async function uid() {
    const { data } = await sb.auth.getUser();
    return data.user?.id || null;
  }

  return {
    demo: false,

    // ---------- autentifikācija ----------
    async getSession() {
      const id = await uid();
      if (!id) return null;
      const profile = ok(await sb.from('profiles').select('*').eq('id', id).single());
      return { userId: id, profile };
    },
    async signIn(email, password) {
      ok(await sb.auth.signInWithPassword({ email, password }));
    },
    async signUp({ email, password, full_name, phone, car, invite_code }) {
      ok(await sb.auth.signUp({ email, password, options: { data: { full_name, phone, car, invite_code } } }));
    },
    async resetPassword(email) {
      ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
    },
    async signOut() { await sb.auth.signOut(); },
    async updateMyProfile(patch) {
      const id = await uid();
      ok(await sb.from('profiles').update(patch).eq('id', id));
    },

    // ---------- iestatījumi ----------
    async getSettings() { return ok(await sb.from('public_settings').select('*').single()); },
    async getAdminSettings() { return ok(await sb.from('settings').select('*').eq('id', 1).single()); },
    async updateSettings(patch) {
      ok(await sb.from('settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1));
    },

    // ---------- rezervācijas ----------
    async listBookings(fromIso, toIso) {
      const rows = ok(await sb.from('bookings')
        .select('id,user_id,starts_at,ends_at,status,note,profiles(full_name)')
        .in('status', ['active', 'completed'])
        .lt('starts_at', toIso).gt('ends_at', fromIso)
        .order('starts_at'));
      return rows.map(r => ({ ...r, full_name: r.profiles?.full_name || '?' }));
    },
    async createBooking(startsIso, endsIso, note) {
      return ok(await sb.rpc('create_booking', { p_starts: startsIso, p_ends: endsIso, p_note: note || null }));
    },
    async cancelBooking(id) { ok(await sb.rpc('cancel_booking', { p_id: id })); },

    // ---------- iečekošanās ----------
    async boxStatus() {
      const rows = ok(await sb.rpc('box_status'));
      return rows?.[0] || null;
    },
    async checkIn(code, pos = null) {
      return ok(await sb.rpc('check_in', { p_code: code, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null, p_acc: pos?.acc ?? null }));
    },
    async checkOut(sessionId = null, pos = null) {
      return ok(await sb.rpc('check_out', { p_session: sessionId, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null, p_acc: pos?.acc ?? null }));
    },
    async reportNotVacated(pos = null, note = null) {
      return ok(await sb.rpc('report_not_vacated', { p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null, p_acc: pos?.acc ?? null, p_note: note || null }));
    },
    async listReports() { return ok(await sb.rpc('list_reports')); },
    async rejectReport(id) { ok(await sb.rpc('reject_report', { p_id: id })); },

    // ---------- noteikumi ----------
    async rulesStatus() { const rows = ok(await sb.rpc('current_rules')); return rows?.[0] || null; },
    async acceptRules(version) { ok(await sb.rpc('accept_rules', { p_version: version })); },
    async publishRules(body) { return ok(await sb.rpc('publish_rules', { p_body: body })); },
    async listRuleAcceptances() { return ok(await sb.rpc('list_rule_acceptances')); },

    // ---------- HOLD ----------
    async boxHold() { const rows = ok(await sb.rpc('box_hold')); return rows?.[0] || null; },
    async listHolds() {
      const [holds, profs] = await Promise.all([
        sb.from('holds').select('*').order('starts_at', { ascending: false }).limit(100),
        sb.from('profiles').select('id,full_name,phone')]);
      const by = Object.fromEntries(ok(profs).map(p => [p.id, p]));
      return ok(holds).map(h => ({ ...h, full_name: by[h.user_id]?.full_name || '?', phone: by[h.user_id]?.phone || '' }));
    },
    async startHold(userId, expectedEndIso, reason) {
      return ok(await sb.rpc('start_hold', { p_user: userId, p_expected_end: expectedEndIso, p_reason: reason || null }));
    },
    async updateHold(id, expectedEndIso, reason) {
      return ok(await sb.rpc('update_hold', { p_id: id, p_expected_end: expectedEndIso, p_reason: reason || null }));
    },
    async endHold(id, amount, note) {
      return ok(await sb.rpc('end_hold', { p_id: id, p_amount: amount || 0, p_note: note || null }));
    },

    // ---------- mans konts ----------
    async mySessions() {
      const id = await uid();
      return ok(await sb.from('sessions').select('*').eq('user_id', id).order('checked_in_at', { ascending: false }).limit(200));
    },
    async myLedger() {
      const id = await uid();
      return ok(await sb.from('ledger').select('*').eq('user_id', id).order('created_at', { ascending: false }));
    },

    // ---------- kase ----------
    async listCash() { return ok(await sb.from('cash_entries').select('*').order('entry_date', { ascending: false }).order('id', { ascending: false })); },
    async addCash(entry) { ok(await sb.from('cash_entries').insert({ ...entry, created_by: await uid() })); },
    async deleteCash(id) { ok(await sb.from('cash_entries').delete().eq('id', id)); },

    // ---------- admins ----------
    async listProfiles() { return ok(await sb.from('profiles').select('*').order('full_name')); },
    async updateProfile(id, patch) { ok(await sb.from('profiles').update(patch).eq('id', id)); },
    async removeMember(id) { ok(await sb.rpc('remove_member', { p_user: id })); },
    async restoreMember(id) { ok(await sb.rpc('restore_member', { p_user: id })); },
    async listInvites() { return ok(await sb.from('invites').select('*, used:profiles!invites_used_by_fkey(full_name)').order('created_at', { ascending: false })); },
    async createInvite(note) { return ok(await sb.from('invites').insert({ note, created_by: await uid() }).select().single()); },
    async deleteInvite(code) { ok(await sb.from('invites').delete().eq('code', code)); },
    async listSessions(fromIso, toIso) {
      const rows = ok(await sb.from('sessions').select('*, profiles!sessions_user_id_fkey(full_name)')
        .gte('checked_out_at', fromIso).lt('checked_out_at', toIso).order('checked_in_at'));
      return rows.map(r => ({ ...r, full_name: r.profiles?.full_name || '?' }));
    },
    async balances() { return ok(await sb.rpc('balances')); },
    async listLedgerAll() {
      const rows = ok(await sb.from('ledger').select('*, profiles!ledger_user_id_fkey(full_name)').order('created_at', { ascending: false }).limit(300));
      return rows.map(r => ({ ...r, full_name: r.profiles?.full_name || '?' }));
    },
    async recordPayment(userId, kind, amount, description, hours) {
      ok(await sb.rpc('record_payment', { p_user: userId, p_kind: kind, p_amount: amount, p_description: description, p_hours: hours ?? null }));
    },
    async closeMonth(monthDate) { return ok(await sb.rpc('close_month', { p_month: monthDate })); },
    async listDevices() { return ok(await sb.from('devices').select('id,kind,name,location,enabled').order('id')); },
  };
}
