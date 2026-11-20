# BOX aplikācija — funkcionālā specifikācija (v1, 20.11.2026)

**Admins:** Aras Noreika · **Kods:** GitHub `arasai-nor/box-app`

**Mērķis:** sakārtot uzņēmuma teritorijā esošās remonta garāžas (BOX, HOFMANN pacēlājs) lietošanu darbinieku privāto auto remontiem. Lietošana notiek tikai ar rezervāciju, laiks tiek uzskaitīts, un iekasētā summa sedz BOX uzturēšanu (elektrība, siltums, nodokļi), bet atlikums aiziet instrumentiem un iekārtām. BOX nav paredzēts peļņai.

## 1. Pieņemtie lēmumi
| # | Jautājums | Lēmums |
|---|---|---|
| 1 | Rezervāciju apstiprināšana | Automātiska. Pārklāšanās nav iespējama, admins var atcelt jebkuru rezervāciju |
| 2 | Maksa | Faktiskais laiks no iečekošanās līdz izčekošanās, minimums 1 h, 2 €/h |
| 3 | Norēķini | Bez bankām. Summas krājas virtuāli. Admins reģistrē nosegšanu ar darbu BOX labā vai skaidru naudu (tā nonāk BOX kasē) |
| 4 | Platforma | PWA: viens kods iPhone un Android, saite caur WhatsApp |
| 5 | Shelly relejs, kameras | Vietas rezervētas, pagaidām neaktīvas |

## 2. Noteikumi (ieprogrammēti datubāzē)
1. **Reģistrācija** notiek ar personīgu vienreizēju ielūguma kodu. Bez koda konts paliek neaktīvs līdz admina apstiprinājumam.
2. **Rezervācija** ir iespējama ar 15 min soli. Pārklāšanās ir bloķēta datubāzē. Atcelt var tikai neizmantotu rezervāciju.
3. **Iečekošanās** notiek tikai ar BOX kodu (QR BOX iekšpusē):
   - ar savu rezervāciju ne agrāk kā 15 min pirms sākuma;
   - bez rezervācijas, ja BOX ir brīvs vismaz nākamo 1 h;
   - vienlaikus BOX var būt tikai viens lietotājs.
4. **Izčekošanās:** summa = max(faktiskās min, 60) / 60 × 2 €. Ja beidz agrāk, atlikušais laiks kalendārā atbrīvojas.
5. **Pret "marinēšanu":** laiks skaitās, līdz lietotājs izčekojas. Admins var izčekot ar roku.
6. **Mēneša slēgšana** notiek 1. datumā automātiski vai ar admina pogu. Summa nonāk lietotāja virtuālajā kontā. Dubulta slēgšana nav iespējama.
7. **Norēķins** ar darbu vai skaidru naudu samazina parādu. Skaidrā nauda reizē tiek ierakstīta kā kases ienākums.
8. **Kases** ienākumi un izdevumi ir redzami visiem lietotājiem.

## 3. Drošība
Lietotājs redz tikai savas sesijas un savu kontu, bet kalendārā visu vārdus un laikus. BOX kods un iekārtu iestatījumi redzami tikai adminam. Paroles glabā Supabase Auth.

## 4. Posmi
| Posms | Saturs | Statuss |
|---|---|---|
| 1. Pamata versija | Ielūgumi, kalendārs, QR iečekošanās, maksa, mans konts, kase, admina panelis, mēneša atskaite un CSV | Uzprogrammēts, gaida palaišanu |
| 2. Disciplīna | Push atgādinājumi, neierašanās noteikums, Shelly relejs pacēlāja barošanai | Rezervēts |
| 3. AI kameras | 2 kameras, aizņemtības detekcija, brīdinājums par lietošanu bez iečekošanās; tiešraide tikai adminam | Rezervēts |

Pirms 2. un 3. posma tiks sagatavots iepirkumu saraksts (amazon.de / LV veikali), slēgumu shēmas un instrukcijas.

## 5. Izmaksas
Supabase Free + GitHub Pages: 0 €/mēn.
