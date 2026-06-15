import { i } from "@instantdb/react";

const _schema = i.schema({
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),
    profiles: i.entity({
      username: i.string().unique().indexed(),
      passwordHash: i.string(),
      books: i.json(),
      shelves: i.json(),
      challenge: i.json().optional(),
      friends: i.json(),
      shelfViewSettings: i.json().optional(),
      genreFetchAllowlist: i.json().optional(),
      readingPace: i.number().optional(),
    }),
    friendRequests: i.entity({
      fromUsername: i.string().indexed(),
      toUsername: i.string().indexed(),
      status: i.string(), // 'pending' | 'accepted' | 'rejected'
    }),
    sharedInboxItems: i.entity({
      toUsername: i.string().indexed(),
      fromUsername: i.string(),
      books: i.json(),
      shelfName: i.string().optional(),
      sharedAt: i.string(),
    }),
  },
  links: {
    profileUser: {
      forward: { on: "profiles", has: "one", label: "$user" },
      reverse: { on: "$users", has: "one", label: "profile" },
    },
  },
});

type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
