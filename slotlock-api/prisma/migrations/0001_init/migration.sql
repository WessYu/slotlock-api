CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

CREATE TYPE "ReservationStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

CREATE TABLE "resources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "resources_slug_key" ON "resources"("slug");

CREATE TABLE "reservations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "resource_id" UUID NOT NULL,
  "customer_email" TEXT NOT NULL,
  "starts_at" TIMESTAMPTZ(3) NOT NULL,
  "ends_at" TIMESTAMPTZ(3) NOT NULL,
  "status" "ReservationStatus" NOT NULL DEFAULT 'CONFIRMED',
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reservations_valid_interval" CHECK ("starts_at" < "ends_at"),
  CONSTRAINT "reservations_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "reservations_idempotency_key_key" ON "reservations"("idempotency_key");
CREATE INDEX "reservations_resource_id_starts_at_idx" ON "reservations"("resource_id", "starts_at");
CREATE INDEX "reservations_customer_email_created_at_idx" ON "reservations"("customer_email", "created_at");

ALTER TABLE "reservations"
ADD CONSTRAINT "reservations_no_overlap"
EXCLUDE USING gist (
  "resource_id" WITH =,
  tstzrange("starts_at", "ends_at", '[)') WITH &&
)
WHERE ("status" = 'CONFIRMED');

INSERT INTO "resources" ("name", "slug") VALUES
  ('Sala Alpha', 'sala-alpha'),
  ('Sala Beta', 'sala-beta');
