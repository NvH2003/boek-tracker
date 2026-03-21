# Edge Function: delete-auth-user

Deze functie verwijdert de ingelogde gebruiker uit Supabase Auth nadat profiel en data al zijn verwijderd. Daardoor kan er met dat account niet meer worden ingelogd.

## Deployen

1. Installeer de [Supabase CLI](https://supabase.com/docs/guides/cli) als dat nog niet is gedaan.
2. Log in: `supabase login`
3. Koppel je project: `supabase link --project-ref <jouw-project-ref>`
4. Deploy de functie: `supabase functions deploy delete-auth-user`

De `SUPABASE_SERVICE_ROLE_KEY` staat automatisch in de Edge Function-omgeving; die hoef je niet handmatig in te stellen.

## Zonder Edge Function

Als je de functie niet deployed, wordt bij accountverwijdering alleen het profiel en de app-data gewist. De auth-user blijft dan bestaan; inloggen lukt niet (geen profiel), maar je ziet wel kort een foutmelding. Deploy van deze functie zorgt ervoor dat inloggen direct mislukt met "Invalid login credentials".

---

# Edge Function: goodreads-genres-nl

Haalt genres op van Goodreads (zoekresultaat → boekpagina) en geeft ze terug zoals op Goodreads. **Geen vertaling** en **geen** LibreTranslate-secrets nodig.

## Deployen (Dashboard)

1. Supabase Dashboard → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Naam: `goodreads-genres-nl`
3. Plak de code uit `supabase/functions/goodreads-genres-nl/index.ts` en klik **Deploy**.

Na elke codewijziging: opnieuw **Deploy** / **Redeploy** voor deze function.

## Deployen (CLI, optioneel)

```bash
supabase functions deploy goodreads-genres-nl
```
