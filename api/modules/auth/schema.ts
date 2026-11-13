import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' }).notNull();

export const authUser = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt'),
  updatedAt: timestamp('updatedAt'),
});

export const authSession = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt'),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt'),
  updatedAt: timestamp('updatedAt'),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
}, (table) => [index('session_userId_idx').on(table.userId)]);

export const authAccount = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt'),
  updatedAt: timestamp('updatedAt'),
}, (table) => [
  index('account_userId_idx').on(table.userId),
  uniqueIndex('account_provider_account_unique').on(table.providerId, table.accountId),
]);

export const authVerification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt'),
  createdAt: timestamp('createdAt'),
  updatedAt: timestamp('updatedAt'),
}, (table) => [index('verification_identifier_idx').on(table.identifier)]);

export const authSchema = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
};
