-- Better Auth D1 schema. Copy this into the next numbered file in /migrations
-- and apply it with Wrangler before accepting signups. Request handlers never
-- create or mutate database schema.
CREATE TABLE IF NOT EXISTS `user` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `email` TEXT NOT NULL UNIQUE,
  `emailVerified` INTEGER NOT NULL DEFAULT 0,
  `image` TEXT,
  `createdAt` INTEGER NOT NULL,
  `updatedAt` INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS `session` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `expiresAt` INTEGER NOT NULL,
  `token` TEXT NOT NULL UNIQUE,
  `createdAt` INTEGER NOT NULL,
  `updatedAt` INTEGER NOT NULL,
  `ipAddress` TEXT,
  `userAgent` TEXT,
  `userId` TEXT NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS `session_userId_idx` ON `session` (`userId`);

CREATE TABLE IF NOT EXISTS `account` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `accountId` TEXT NOT NULL,
  `providerId` TEXT NOT NULL,
  `userId` TEXT NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `accessToken` TEXT,
  `refreshToken` TEXT,
  `idToken` TEXT,
  `accessTokenExpiresAt` INTEGER,
  `refreshTokenExpiresAt` INTEGER,
  `scope` TEXT,
  `password` TEXT,
  `createdAt` INTEGER NOT NULL,
  `updatedAt` INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS `account_userId_idx` ON `account` (`userId`);
CREATE UNIQUE INDEX IF NOT EXISTS `account_provider_account_unique` ON `account` (`providerId`, `accountId`);

CREATE TABLE IF NOT EXISTS `verification` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `identifier` TEXT NOT NULL,
  `value` TEXT NOT NULL,
  `expiresAt` INTEGER NOT NULL,
  `createdAt` INTEGER NOT NULL,
  `updatedAt` INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS `verification_identifier_idx` ON `verification` (`identifier`);
