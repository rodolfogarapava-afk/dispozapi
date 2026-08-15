-- Painel admin de plataforma: status/MRR/trial por organização e super-admin por usuário.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "OrgStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable: organizations
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "status" "OrgStatus" NOT NULL DEFAULT 'TRIAL';
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "mrr" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable: users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;
