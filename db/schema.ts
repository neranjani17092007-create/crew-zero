import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const rooms = sqliteTable('rooms', { code: text('code').primaryKey(), state: text('state').notNull(), revision: integer('revision').notNull().default(0), expires: integer('expires').notNull() }, t => [index('rooms_expires_idx').on(t.expires)]);
