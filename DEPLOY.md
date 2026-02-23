# Boek Tracker – deployen en testen op je telefoon

## Snelste manier (online in een paar minuten)

1. **Build maken** (in de projectmap in de terminal):
   ```bash
   npm install
   npm run build
   ```
2. **Uploaden:** ga naar **[app.netlify.com/drop](https://app.netlify.com/drop)** (gratis account aanmaken als dat nog niet bestaat).
3. **Sleep** de map **`dist`** (die na de build in je projectmap staat) naar het drag-and-drop scherm.
4. Netlify geeft je direct een link, bijv. `https://random-name-123.netlify.app`.
5. **Op je Android-telefoon:** open die link in Chrome → menu (⋮) → **"App installeren"** of **"Toevoegen aan startscherm"**. De app opent daarna als een app.

Klaar. Geen Git of CLI nodig.

---

## 1. PWA-installatie (Android & iOS)

Na deployen kun je de app op je telefoon **op het startscherm zetten**:

- **Android (Chrome):** Menu (⋮) → "App installeren" / "Toevoegen aan startscherm".
- **iOS (Safari):** Deel-knop → "Zet op beginscherm".

De app draait dan in een eigen venster (zonder browserknoppen) en is offline bruikbaar voor eerder geladen pagina’s.

## 2. Lokaal bouwen

```bash
npm install
npm run build
```

De output staat in `dist/`. Die map kun je uploaden naar een host.

## 3. Deployen (niet meer lokaal draaien)

### Optie A: Vercel (gratis, eenvoudig)

1. Account op [vercel.com](https://vercel.com).
2. Installeer de Vercel CLI: `npm i -g vercel`
3. In de projectmap: `vercel` en volg de stappen (login, projectnaam).
4. Bij "Override settings": **Build Command** = `npm run build`, **Output Directory** = `dist`.
5. Na deploy krijg je een URL, bijv. `https://boek-tracker-xxx.vercel.app`.

Op je telefoon: open die URL in de browser en voeg toe aan startscherm (zie stap 1).

### Optie B: Netlify

1. Account op [netlify.com](https://netlify.com).
2. "Add new site" → "Import an existing project" (bijv. Git) of "Deploy manually".
3. Bij handmatig: sleep de `dist/` map (na `npm run build`) naar het drag-and-drop gebied.
4. Of koppel een Git-repo: Build command = `npm run build`, Publish directory = `dist`.

Netlify stuurt je een URL. Open die op je telefoon en zet de app op het startscherm.

### Optie C: Andere static host

Upload de inhoud van `dist/` naar een willekeurige static host (GitHub Pages, Cloudflare Pages, je eigen server). Zorg dat alle routes naar `index.html` gaan (SPA), zoals in `vercel.json` staat.

## 4. PWA-icons (optioneel)

Voor een eigen icoon op het startscherm: plaats `icon-192x192.png` en `icon-512x512.png` in `public/icons/`.  
Genereer ze bijvoorbeeld via [PWA Builder Image Generator](https://www.pwabuilder.com/imageGenerator) (upload `public/favicon.svg`). Daarna opnieuw `npm run build` en opnieuw deployen.

## 5. Testen op je telefoon

1. Deploy zoals hierboven en noteer de URL.
2. Open die URL op je telefoon (Wi‑Fi of mobiele data).
3. Log in of maak een account.
4. Voeg de app toe aan het startscherm (zie stap 1) voor app-achtig gedrag.

Let op: data (boeken, accounts) staat in de **localStorage van de browser**. Die is per apparaat en per browser. Er is geen cloud-sync tenzij je die later toevoegt.
