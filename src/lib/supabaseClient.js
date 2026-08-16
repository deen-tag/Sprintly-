import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Message clair si le .env a été oublié, plutôt qu'une erreur obscure.
  console.error(
    "Variables VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY manquantes. Vérifie ton fichier .env (voir .env.example)."
  );
}

export const supabase = createClient(url, key, {
  auth: {
    // L'app utilise déjà le # de l'URL pour sa propre navigation (#join?id=...).
    // Le flow par défaut de Supabase renvoie aussi ses jetons dans le #, ce qui
    // écrase/casse la route de l'app. Le flow PKCE utilise ?code=... à la place,
    // qui ne rentre jamais en collision avec le routeur.
    flowType: "pkce",
    detectSessionInUrl: true,
  },
});
