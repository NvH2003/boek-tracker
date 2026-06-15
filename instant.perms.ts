import type { InstantRules } from "@instantdb/react";

// Profiles: leesbaar voor alle ingelogde gebruikers (nodig voor buddy-zoeken en leeslijst delen).
// Schrijven alleen door de eigenaar.
const rules = {
  profiles: {
    allow: {
      view: "auth.id != null",
      create: "auth.id != null",
      update: "auth.id != null && (data.ref('$user.id') == auth.id)",
      delete: "auth.id != null && (data.ref('$user.id') == auth.id)",
    },
  },
  friendRequests: {
    allow: {
      view: "auth.id != null",
      create: "auth.id != null",
      update: "auth.id != null",
      delete: "auth.id != null",
    },
  },
  sharedInboxItems: {
    allow: {
      view: "auth.id != null",
      create: "auth.id != null",
      update: "auth.id != null",
      delete: "auth.id != null",
    },
  },
} satisfies InstantRules;

export default rules;
