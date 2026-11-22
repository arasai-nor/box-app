# BOX aplikācija — funkcionālā specifikācija (v1.4, 22.11.2026)

**Admins:** Aras Noreika · **Kods:** GitHub `arasai-nor/box-app`

**Mērķis:** sakārtot uzņēmuma teritorijā esošās remonta garāžas (BOX, HOFMANN pacēlājs) lietošanu darbinieku privāto auto remontiem. Lietošana notiek tikai ar rezervāciju, laiks tiek uzskaitīts, un iekasētā summa sedz BOX uzturēšanu (elektrība, siltums, nodokļi), bet atlikums aiziet instrumentiem un iekārtām. BOX nav paredzēts peļņai.

## 1. Pieņemtie lēmumi
| # | Jautājums | Lēmums |
|---|---|---|
| 1 | Rezervāciju apstiprināšana | Automātiska. Pārklāšanās nav iespējama, admins var atcelt jebkuru rezervāciju |
| 2 | Maksa | 2 €/h par laiku no iečekošanās līdz izčekošanās; minimums 1 h, tālāk pa 30 min: atlikumu līdz 15 min (ieskaitot) noapaļo uz leju, vairāk — uz augšu (1:15 → 1:00; 1:20 → 1:30; 1:44 → 1:30; 1:47 → 2:00) |
| 3 | Norēķini | Bez bankām. Summas krājas virtuāli. Admins reģistrē nosegšanu ar darbu BOX labā vai skaidru naudu (tā nonāk BOX kasē) |
| 4 | Platforma | PWA: viens kods iPhone un Android, saite caur WhatsApp |
| 5 | Shelly relejs, kameras | Vietas rezervētas, pagaidām neaktīvas |
| 6 | Atrašanās vietas pārbaude | Iečekoties, izčekoties un ziņot var tikai 250 m rādiusā no BOX (Viskaļu iela 22, Rīga; punkts 56.990484, 24.185431). Rādiusu un punktu maina admins |
| 8 | Noteikumi | Aplikācija darbojas tikai pēc tam, kad dalībnieks izlasījis un apstiprinājis īsos BOX noteikumus. Glabājas, kurš kuru versiju un kad apstiprinājis. Jauna versija = visiem jāapstiprina no jauna |
| 9 | HOLD | Avārijas vai ilga remonta gadījumā admins aptur BOX konkrētam dalībniekam. To redz visi. Stundu skaitītājs HOLD laikā neskaita; summu, par ko vienojas, admins ieraksta, beidzot HOLD |
| 10 | Dalībnieku maiņa | Jaunu dalībnieku admins pievieno ar personīgu ielūguma saiti (Admins → Dalībnieki → Pievienot dalībnieku). Dalībnieku, kurš aiziet, admins izslēdz: viņš aplikācijā redz paziņojumu, ka vairs nav BOX dalībnieks; vēsture un atlikums saglabājas; dalību var atjaunot |
| 11 | Dizains | Gaišs fons, noapaļotas kartītes, peldoša navigācija; statusa bloks pilnā krāsā ar lieliem burtiem: zaļš = brīvs, sarkans = aizņemts, dzeltens = HOLD |
| 7 | Neatbrīvots BOX | Nākamais lietotājs var ziņot "BOX nav atbrīvots"; iepriekšējam laiks atkal skaitās no viņa iečekošanās |

## 2. Noteikumi (ieprogrammēti datubāzē)
1. **Reģistrācija** notiek ar personīgu vienreizēju ielūguma kodu. Bez koda konts paliek neaktīvs līdz admina apstiprinājumam.
2. **Rezervācija** ir iespējama ar 15 min soli. Pārklāšanās ir bloķēta datubāzē. Atcelt var tikai neizmantotu rezervāciju.
3. **Iečekošanās** notiek tikai ar BOX kodu (QR BOX iekšpusē):
   - ar savu rezervāciju ne agrāk kā 15 min pirms sākuma;
   - bez rezervācijas, ja BOX ir brīvs vismaz nākamo 1 h;
   - vienlaikus BOX var būt tikai viens lietotājs.
4. **Izčekošanās:** tikai uz vietas (GPS) un tikai ar BOX foto, ko aplikācija uzņem ar kameru (no galerijas izvēlēties nevar). Summa = aprēķina minūtes / 60 × 2 €, kur aprēķina minūtes = minimums 60, tālāk pa 30 min ar noapaļošanu pie 15 min. Ja beidz agrāk, atlikušais laiks kalendārā atbrīvojas. Admins var izčekot citu dalībnieku bez foto.
5. **Pret "marinēšanu":** laiks skaitās, līdz lietotājs izčekojas. Admins var izčekot ar roku.
6. **Mēneša slēgšana** notiek 1. datumā automātiski vai ar admina pogu. Summa nonāk lietotāja virtuālajā kontā. Dubulta slēgšana nav iespējama.
7. **Norēķins** ar darbu vai skaidru naudu samazina parādu. Skaidrā nauda reizē tiek ierakstīta kā kases ienākums.
8. **Kases** ienākumi un izdevumi ir redzami visiem lietotājiem.
9. **Atrašanās vieta:** iečekojoties, izčekojoties un ziņojot aplikācija pārbauda telefona atrašanās vietu (rādiuss 250 m, GPS neprecizitātes pielaide līdz 100 m). Adminam, izčekojot citu lietotāju, pārbaude netiek piemērota. Pārbaudi var izslēgt admina iestatījumos.
10. **"BOX nav atbrīvots":** ja BOX nav iečekots, bet tajā stāv iepriekšējā lietotāja auto, jebkurš cits lietotājs uz vietas var to ziņot. Pēdējā lietotāja sesija tiek atvērta no jauna, un laiks skaitās no viņa sākotnējās iečekošanās, līdz viņš izčekojas uz vietas. Ziņot nevar, ja kopš izčekošanās pagājušas vairāk nekā 14 dienas vai mēnesis jau slēgts. Kļūdainu ziņojumu admins noraida, un tiek atjaunots sākotnējais laiks un summa.
11. **Mēneša piederība:** lietošanas reize tiek ieskaitīta tajā mēnesī, kurā notikusi izčekošanās.
12. **Noteikumu apstiprināšana:** kamēr dalībnieks nav apstiprinājis jaunāko noteikumu versiju, viņš redz tikai noteikumu ekrānu, un datubāze neļauj rezervēt, iečekoties vai skatīt kalendāru. Noteikumu tekstu admins maina sadaļā Admins → Noteikumi.
13. **HOLD:** vienlaikus var būt tikai viens. Uzliekot HOLD, citu dalībnieku rezervācijas šajā laikā tiek atceltas; ja dalībnieks pats ir iečekots, viņa sesija tiek noslēgta ar parasto maksu. HOLD laikā nevar rezervēt, iečekoties un ziņot. HOLD redzams sākuma ekrānā un kalendārā ar dalībnieka vārdu, iemeslu, aptuveno beigu laiku un saziņas pogām. Beidzot HOLD, admins ieraksta summu (var būt 0), kas nonāk dalībnieka kontā.
15. **Izslēgšana:** izslēgt nevar dalībnieku, kurš tobrīd ir iečekots vai kuram ir aktīvs HOLD. Izslēdzot tiek atceltas viņa nākotnes rezervācijas un noņemtas admina tiesības. Izslēgtais var ielogoties, bet redz tikai paziņojumu par dalības beigām un savu nenokārtoto atlikumu.
14. **Brīdinājums par aizbraukšanu:** ja dalībnieks ir iečekots un aplikācija ir atvērta, bet telefons vairs nav BOX zonā, parādās sarkans brīdinājums ar vibrāciju un saziņu ar adminu. Kad aplikācija ir aizvērta, tīmekļa aplikācija atrašanās vietu izsekot nevar; šim gadījumam 2. posmā būs servera push atgādinājumi (pēc rezervācijas beigām un ik pēc noteikta laika, kamēr sesija ir atvērta).

### Papildinājumi v1.4 (22.11.2026)

- **Foto izčekojoties** — obligāts (iestatījums `photo_required`). Uz foto tiek uzdrukāts vārds, datums un laiks. Foto redz admins (Mēneša atskaite → 📷) un nākamais lietotājs sākuma ekrānā ("Pēdējā lietošana"). Glabāšana: Supabase Storage, privāta krātuve `checkout`; demo režīmā — tikai pēdējie 12 foto pārlūkā.
- **Rezervāciju limits** — vienam dalībniekam ne vairāk kā 2 nākotnes rezervācijas (`max_active_bookings`, 0 = bez limita). Iečekošanās bez rezervācijas limitā neskaitās.
- **Bojājumu un trūkumu žurnāls** — jebkurš dalībnieks ziņo sākuma ekrānā; atvērtos ierakstus redz visi; admins atzīmē kā atrisinātu (Admins → Ziņojumi).
- **Uzkrājums** — katrs dalībnieks sadaļā "Mans konts" redz kopējo uzkrāto summu (slēgtie mēneši + vēl neslēgtā lietošana − nokārtotais); admins redz visus (Admins → Dalībnieki un Norēķini).
- **Norēķini ar darbu** — bez cenrāža: par katru darbu (granulas, sniegs, lapas, renes, saules paneļi u.c.) un tā summu admins ar dalībnieku vienojas atsevišķi; darbi notiek ārpus darba laika. Admins ieraksta aprakstu un summu brīvā formā (Admins → Norēķini → "Darbs pēc vienošanās").
- **Atgādinājums** — ja uzkrāts vismaz 30 € (`debt_warn_eur`), dalībnieks sākuma ekrānā redz atgādinājumu norēķināties. Ja nenokārto — admins var slēgt piekļuvi. Ieturēšana no algas aplikācijā nav paredzēta: tai vajadzīgs dalībnieka rakstveida iesniegums par konkrētu summu (saskaņot ar grāmatvedi).
- **Ielūgumi** — admins ieraksta vārdu, uzvārdu un (pēc izvēles) telefonu; saiti nosūta ar WhatsApp vai SMS.
- **Noteikumi** — atjaunoti (15 punkti), sk. `docs/BOX_lietosanas_noteikumi_projekts.md`.
- **Nav iekļauts:** admina vietnieks, darbu cenrādis, "paziņot, kad atbrīvojas".

## 3. Drošība
Lietotājs redz tikai savas sesijas un savu kontu, bet kalendārā visu vārdus un laikus. BOX kods un iekārtu iestatījumi redzami tikai adminam. Paroles glabā Supabase Auth.

## 4. Posmi
| Posms | Saturs | Statuss |
|---|---|---|
| 1. Pamata versija | Ielūgumi, kalendārs, QR iečekošanās, atrašanās vietas pārbaude, ziņošana par neatbrīvotu BOX, maksa, mans konts, kase, admina panelis, mēneša atskaite un CSV | Uzprogrammēts; demo versija: https://arasai-nor.github.io/box-app/ ; gaida datubāzes pieslēgšanu |
| 2. Disciplīna | Servera push atgādinājumi (arī par neizčekošanos), neierašanās noteikums, Shelly relejs pacēlāja barošanai | Rezervēts |
| 3. AI kameras | 2 kameras, aizņemtības detekcija, brīdinājums par lietošanu bez iečekošanās; tiešraide tikai adminam | Rezervēts |

Pirms 2. un 3. posma tiks sagatavots iepirkumu saraksts (amazon.de / LV veikali), slēgumu shēmas un instrukcijas.

## 5. Izmaksas
Supabase Free + GitHub Pages: 0 €/mēn.
