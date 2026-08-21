-- Creates image_search.image_metadata and image_search.fabric from scratch,
-- matching src/image-metadata/image-metadata.entity.ts and src/fabric/fabric.entity.ts.
-- Run after 000_create_image_search_schema.sql. Safe to re-run (IF NOT EXISTS).
-- Keep this file in sync with the entities if you add/change columns instead of
-- relying on DB_SYNCHRONIZE against the shared DB.

CREATE TABLE IF NOT EXISTS image_search.image_metadata (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "entityType"          VARCHAR NOT NULL,
  "entityId"            VARCHAR NOT NULL,
  "imageUrl"            VARCHAR NOT NULL,
  "categoryId"          VARCHAR,
  "subcategoryId"       VARCHAR,
  tags                  JSONB NOT NULL,
  "rawLabels"           JSONB,
  provider_metadata     JSONB,
  embedding             VECTOR(768),
  dominant_colors_rgb   JSONB,
  dominant_colors_lab   JSONB,
  "createdAt"           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS image_metadata_created_at_idx
  ON image_search.image_metadata ("createdAt");

CREATE TABLE IF NOT EXISTS image_search.fabric (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "entityId"    VARCHAR NOT NULL,
  "imageUrl"    VARCHAR NOT NULL,
  pattern       VARCHAR NOT NULL,
  weave         VARCHAR NOT NULL,
  colors        JSONB NOT NULL,
  "fabricType"  VARCHAR NOT NULL,
  confidence    DOUBLE PRECISION NOT NULL,
  embedding     VECTOR(768) NOT NULL,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS fabric_entity_id_uq_idx
  ON image_search.fabric ("entityId");

CREATE INDEX IF NOT EXISTS fabric_created_at_idx
  ON image_search.fabric ("createdAt");
