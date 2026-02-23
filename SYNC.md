# Sync tussen apparaten (Supabase)

Met Supabase kun je met hetzelfde account inloggen op pc en telefoon; je boeken, planken, challenge en vrienden synchroniseren dan tussen apparaten.

---

## Simpel: wat gebeurt er?

**Zonder sync:**  
Je boeken staan alleen op de plek waar je ze invoert. Op de pc heb je je lijst, op de telefoon een andere (of leeg). Ze praten niet met elkaar.

**Met sync:**  
We gebruiken een “kast in de cloud” (Supabase). Wat je op de pc doet, gaat naar die kast. Wat je op de telefoon doet, gaat ook naar die kast. En als je ergens inlogt, haalt de app je spul uit die kast. Zo staat overal hetzelfde.

**Wat jij moet doen:**  
Eerst de “kast” klaarzetten (eenmalig). Daarna gewoon overal **inloggen met dezelfde gebruikersnaam en hetzelfde wachtwoord**. De app zorgt dan zelf dat je boeken overal hetzelfde zijn.

---

## Stappen in het kort

1. **Kast klaarzetten** → Supabase-project maken, schema draaien, wachtwoorden in `.env` zetten (zie hieronder).
2. **Op de pc** → Een keer inloggen (of registreren). Je boeken gaan naar de kast.
3. **Op je telefoon** → Nieuwe app installeren, inloggen met **dezelfde** gebruikersnaam en wachtwoord. De app haalt je boeken uit de kast.
4. **Klaar** → Overal hetzelfde account, dezelfde boeken. Geen boeken opnieuw invoeren.

---

## Setup (eenmalig)

1. **Supabase-project**
   - Ga naar [supabase.com](https://supabase.com) en maak een project aan.

2. **Schema**
   - Open in het dashboard **SQL Editor** en voer het script uit in `supabase/schema.sql` (eenmalig). Daarmee kunnen ook Boekbuddies elkaars leeslijst zien op elk apparaat.

3. **E-mailbevestiging uitzetten**
   - **Authentication** → **Providers** → **Email**: zet **Confirm email** uit, zodat je direct kunt inloggen na registratie.

4. **Env-variabelen (de “wachtwoorden” voor je Supabase-kast)**

   De app moet weten *welke* Supabase-kast ze moet gebruiken. Dat zet je in een bestand `.env` in je projectmap.

   **Stap A – Bestand maken**
   - In de map van je Boek Tracker-project (waar ook `package.json` staat) moet een bestand heten: **`.env`** (met een punt ervoor).
   - Als je een bestand **`.env.example`** ziet: maak een *kopie* en noem die kopie **`.env`**. Of maak een nieuw tekstdocument, noem het `.env` en plak daar de twee regels hieronder in.

   **Stap B – Waarden uit Supabase halen**
   - Log in op [supabase.com](https://supabase.com) en open *jouw* project.
   - Klik links op het **tandwiel** (Settings).
   - Klik op **API** of **API Keys** (onder “Project Settings”).
   - **Project URL:** Staat vaak op het tabblad **General** of **API** (bijv. `https://abcdefgh.supabase.co`). Die heb je voor de eerste regel.
   - **Sleutel voor in de browser:** Bij **API Keys** zie je **Publishable key** (veilig voor in de app). Kopieer die hele sleutel (bijv. `sb_publishable_...`) → die heb je voor `VITE_SUPABASE_ANON_KEY`.  
     - Zie je alleen “Legacy anon, service_role API keys”? Gebruik dan de **anon**-sleutel (de lange die met `eyJ...` begint) voor `VITE_SUPABASE_ANON_KEY`.

   **Stap C – In .env invullen**
   - Open het bestand `.env` in een teksteditor (Kladblok, VS Code, etc.).
   - Zet er precies twee regels in (vervang de voorbeelden door *jouw* waarden uit Supabase):

     ```
     VITE_SUPABASE_URL=https://jouw-project-id.supabase.co
     VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.jouw-lange-sleutel...
     ```

   - **Eerste regel:** `VITE_SUPABASE_URL=` en daarachter de **Project URL** uit Supabase (zonder aanhalingstekens).
   - **Tweede regel:** `VITE_SUPABASE_ANON_KEY=` en daarachter de **anon/public key** uit Supabase (zonder aanhalingstekens).
   - Sla het bestand op. Zonder dit bestand (of met verkeerde waarden) kan de app niet met je Supabase-kast praten en werkt sync niet.

Na het invullen van `.env` wordt bij inloggen en bij elke wijziging je data naar Supabase weggeschreven. Op een ander apparaat log je in met dezelfde gebruikersnaam en wachtwoord; je data wordt daar opgehaald.

---

**Samengevat:** Zet één keer Supabase en je `.env` goed. Daarna overal gewoon **dezelfde gebruikersnaam en hetzelfde wachtwoord** gebruiken om in te loggen. De rest doet de app.
