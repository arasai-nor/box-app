// BOX aplikācijas konfigurācija.
// Kamēr SUPABASE_URL ir tukšs, aplikācija strādā DEMO režīmā (dati glabājas tikai šajā pārlūkā).
// Pēc Supabase projekta izveides ielīmē šeit vērtības no: Supabase → Project Settings → API.
export const CONFIG = {
  SUPABASE_URL: '',        // piem. 'https://abcdxyz.supabase.co'
  SUPABASE_ANON_KEY: '',   // "anon public" atslēga (drīkst būt publiska)
  APP_NAME: 'BOX',
  TIMEZONE: 'Europe/Riga',
};
