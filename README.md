# BOX — garāžas rezervācija un lietošanas uzskaite

Tīmekļa aplikācija (PWA) BOX remonta garāžai ar HOFMANN pacēlāju. Tā instalējas uz iPhone un Android telefona sākuma ekrāna bez App Store un Google Play.

**Ko tā dara:** rezervē BOX kalendārā (pārklāšanās nav iespējama), iečeko un izčeko ar QR kodu BOX iekšpusē (ar atrašanās vietas pārbaudi 250 m rādiusā), ļauj ziņot par neatbrīvotu BOX, prasa apstiprināt BOX noteikumus, atbalsta HOLD režīmu un skaita maksu par faktisko laiku (2 €/h, minimums 1 h). Tai ir virtuālais konts (parāds BOX kasei), ko var nosegt ar darbu vai skaidru naudu, un caurspīdīga BOX kase. Mēnesis tiek slēgts automātiski katra mēneša 1. datumā.

Kamēr `js/config.js` nav aizpildīts, aplikācija strādā **DEMO režīmā**: dati glabājas tikai tajā pārlūkā.

---

## Palaišana — soli pa solim (vienreiz, ~30 min)

### 1. Datubāze (Supabase, bez maksas)
1. https://supabase.com → **Start your project** → ielogojies ar GitHub (arasai-nor).
2. **New project** → nosaukums `box`, reģions **Frankfurt (eu-central-1)**, izveido datubāzes paroli un saglabā to.
3. Kreisajā izvēlnē **SQL Editor** → **New query** → ielīmē visu `supabase/schema.sql` saturu → **Run**. Skripts izveido arī privātu foto krātuvi `checkout` (Storage) BOX foto glabāšanai.
4. **Authentication → Sign In / Providers → Email**: izslēdz **Confirm email** (ielūguma kods jau aizsargā pret svešiem).
5. **Database → Extensions** → ieslēdz **pg_cron**. Tad SQL Editor palaid `schema.sql` beigās esošo bloku (noņem `--` komentāru zīmes), lai mēnesis slēgtos automātiski 1. datumā.
6. **Project Settings → API**: nokopē **Project URL** un **anon public** atslēgu un ieraksti tās `js/config.js`.

### 2. Hostings (GitHub Pages, bez maksas)
1. Repozitorijā `arasai-nor/box-app` augšupielādē visus šīs mapes failus.
2. **Settings → Pages → Branch: main / root → Save**.
3. Pēc ~1 min aplikācija ir pieejama: `https://arasai-nor.github.io/box-app/`

### 3. Pirmā ielogošanās
1. Atver adresi → **Reģistrēties**. **Pirmais reģistrētais lietotājs automātiski kļūst par administratoru**, tāpēc reģistrējies pats pirmais. Ielūguma kodu vari ievadīt jebkādu.
2. **Admins → Iestatījumi un QR** → **Drukāt** → piestiprini QR BOX iekšpusē.
3. **Admins → Ielūgumi** → katram cilvēkam izveido ielūgumu → **Sūtīt WhatsApp**.

---

## Faili
| Fails | Saturs |
|---|---|
| `index.html`, `css/app.css` | Lapa un izskats |
| `js/app.js` | Ekrāni un loģika |
| `js/api-supabase.js` | Savienojums ar datubāzi |
| `js/api-demo.js` | Demo režīms (tie paši noteikumi, dati pārlūkā) |
| `js/config.js` | **Supabase adrese un atslēga** |
| `supabase/schema.sql` | Datubāze, noteikumi, drošība (RLS) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalēšana uz telefona |
| `docs/SPECIFIKACIJA.md` | Funkcionālā specifikācija un posmi |
| `docs/BOX_lietosanas_noteikumi_projekts.md` | Iekšējo noteikumu projekts |
