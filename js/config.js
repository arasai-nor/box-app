// BOX aplikācijas konfigurācija.
// Ja SUPABASE_URL ir tukšs, aplikācija strādā DEMO režīmā (dati glabājas tikai šajā pārlūkā).
// Vērtības: Supabase → Project Settings → API Keys. Šeit drīkst būt TIKAI publiskā (publishable/anon) atslēga —
// tā ir paredzēta ievietošanai aplikācijā; datus sargā datubāzes noteikumi (RLS). Slepeno (secret) atslēgu šeit nekad neliec.
export const CONFIG = {
  SUPABASE_URL: 'https://xbslerbyyvkancretoby.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_pUWQF5HeyJrP0pAI_BNeIQ_Bdc2qJdo',   // publiskā atslēga
  APP_NAME: 'BOX',
  TIMEZONE: 'Europe/Riga',
};
