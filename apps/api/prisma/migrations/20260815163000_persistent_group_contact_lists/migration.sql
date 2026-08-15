CREATE TABLE "group_contact_lists" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "instanceId" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "group_contact_lists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "group_contact_list_members" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_contact_list_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "group_contact_lists_organizationId_groupJid_key"
    ON "group_contact_lists"("organizationId", "groupJid");

CREATE INDEX "group_contact_lists_organizationId_importedAt_idx"
    ON "group_contact_lists"("organizationId", "importedAt");

CREATE UNIQUE INDEX "group_contact_list_members_listId_contactId_key"
    ON "group_contact_list_members"("listId", "contactId");

CREATE INDEX "group_contact_list_members_contactId_idx"
    ON "group_contact_list_members"("contactId");

ALTER TABLE "group_contact_lists"
    ADD CONSTRAINT "group_contact_lists_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_contact_list_members"
    ADD CONSTRAINT "group_contact_list_members_listId_fkey"
    FOREIGN KEY ("listId") REFERENCES "group_contact_lists"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_contact_list_members"
    ADD CONSTRAINT "group_contact_list_members_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "contacts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
