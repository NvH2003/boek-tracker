# Boek Tracker als Android-app (APK)

Zo maak je een **echte app** die je op je telefoon installeert (geen website in de browser).

## Wat je nodig hebt

- **Node.js** (staat al op je pc als je het project kunt bouwen)
- **Android Studio** – gratis te downloaden op [developer.android.com/studio](https://developer.android.com/studio)

## Stappen

### 1. Pakketten installeren

In de projectmap:

```bash
npm install
```

### 2. Android-platform toevoegen (eenmalig)

```bash
npx cap add android
```

Er wordt een map `android/` aangemaakt met het Android-project.

### 3. App bouwen en naar Android kopiëren

**Optie A – APK vanaf de terminal (aanbevolen op Windows)**

```bash
npm run build:apk
```

Dit bouwt de app, synct naar Android en maakt direct een **debug-APK**. Het bestand staat daarna in:

`android/app/build/outputs/apk/debug/app-debug.apk`

**Optie B – Alleen sync, daarna APK in Android Studio**

```bash
npm run build:app
```

Dit doet: `npm run build` (maakt `dist/`) en daarna `npx cap sync` (kopieert de build naar het Android-project). Daarna kun je in Android Studio de APK bouwen.

**Op Mac/Linux:** na `npm run build:app` kun je de APK ook vanaf de terminal maken met:
`cd android && ./gradlew assembleDebug`

### 4. APK maken in Android Studio (als je geen `build:apk` gebruikt)

1. Open Android Studio.
2. **File → Open** en kies de map **`android`** in je Boek Tracker-project.
3. Wacht tot Gradle klaar is (onderaan “Gradle sync finished”).
4. Menu **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
5. Als het klaar is, klik op **“locate”** in de melding rechtsonder (of ga naar `android/app/build/outputs/apk/debug/`). Daar staat **`app-debug.apk`**.

### 5. App op je telefoon zetten

- **Optie A:** Verbind je telefoon met USB (USB-debugging aan in Ontwikkelopties). In Android Studio: **Run** (groene play) en kies je apparaat. De app wordt geïnstalleerd en gestart.
- **Optie B:** Kopieer `app-debug.apk` naar je telefoon (e-mail, Google Drive, USB). Open het bestand op je telefoon en installeer (sta “Onbekende bronnen” toe als dat gevraagd wordt).

---

## Daarna: wijzigingen in de app

Als je iets in de code aanpast:

1. `npm run build:app`
2. In Android Studio: **Run** (groene play) om op je telefoon te installeren, of opnieuw **Build → Build APK(s)** voor een nieuwe APK.

---

## Nieuwe versie installeren (bijv. na Supabase-update)

Als je al een oudere Boek Tracker-app op je telefoon hebt en je wilt de nieuwe versie (met sync) installeren:

### Stap 1: Nieuwe APK bouwen op je pc

1. Open een terminal in de projectmap (waar `package.json` staat).
2. Voer uit:
   ```bash
   npm run build:app
   ```
   Dit bouwt de website en kopieert die naar de map `android/`.
3. Open **Android Studio** → **File → Open** → kies de map **`android`** in je Boek Tracker-project.
4. Wacht tot onderaan “Gradle sync finished” staat.
5. Menu **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
6. Als het klaar is: klik op **“locate”** in de melding rechtsonder. De APK staat in:
   `android/app/build/outputs/apk/debug/app-debug.apk`

### Stap 2: Oude app op je telefoon (alleen als nodig)

- **Meestal hoef je de oude app niet te verwijderen.** Installeer gewoon de nieuwe APK; Android vervangt de oude versie (zelfde app-id).
- **Verwijderen alleen doen als:** de installatie mislukt, of je wilt echt een schone start (alle lokale data op de telefoon gaat dan weg).

**Oude app verwijderen op Android:**
- Ga naar **Instellingen → Apps → Boek Tracker** (of zoek op “Boek Tracker”) → **Verwijderen**.
- Of: lang indrukken op het app-icoon → **App-info** (of “i”) → **Verwijderen**.

### Stap 3: Nieuwe APK op je telefoon zetten

**Optie A – Via USB (aanbevolen)**  
1. Zet **USB-debugging** aan: Instellingen → Over de telefoon → tik 7× op “Buildnummer” → terug naar Instellingen → **Ontwikkelopties** → **USB-debugging** aan.
2. Verbind je telefoon met de pc met een USB-kabel.
3. In Android Studio: klik op de groene **Run**-knop (of **Run → Run 'app'**) en kies je telefoon. De nieuwe versie wordt geïnstalleerd en gestart.

**Optie B – APK-bestand naar telefoon**  
1. Kopieer het bestand **`app-debug.apk`** (uit `android/app/build/outputs/apk/debug/`) naar je telefoon (e-mail, Google Drive, USB-koppeling, enz.).
2. Open op je telefoon het bestand (bijv. uit de mail of Downloads).
3. Tik op “Installeren”. Als Android vraagt om “Onbekende bronnen” of “Installeren van dit bron toestaan”, sta dat toe voor die bron (bijv. Bestanden of Gmail).
4. Na de installatie kun je de app openen.

Als je de oude app niet had verwijderd, blijven je **lokale** gegevens op de telefoon gewoon staan. Met Supabase log je daarna in met hetzelfde account; je data wordt dan gesynchroniseerd.

---

## Let op

- De **debug-APK** is bedoeld om te testen. Voor publicatie in de Play Store moet je later een release-build maken en signeren.
- Met Supabase kun je met hetzelfde account inloggen op pc en telefoon; je data synchroniseert dan (zie SYNC.md).
