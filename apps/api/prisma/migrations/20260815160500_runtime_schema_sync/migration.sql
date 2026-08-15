-- Sincroniza o banco com campos adicionados ao schema após as migrações iniciais.

-- AlterEnum
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'PENDING';

-- AlterTable
ALTER TABLE "conversations"
ADD COLUMN IF NOT EXISTS "aiCategory" TEXT,
ADD COLUMN IF NOT EXISTS "aiStageSuggested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "botPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "botPausedReason" TEXT,
ADD COLUMN IF NOT EXISTS "botPausedUntil" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "profilePicUrl" TEXT;

-- AlterTable
ALTER TABLE "messages"
ADD COLUMN IF NOT EXISTS "senderName" TEXT;

-- AlterTable
ALTER TABLE "organizations"
ADD COLUMN IF NOT EXISTS "settings" JSONB;
