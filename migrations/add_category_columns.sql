ALTER TABLE image_search.image_metadata DROP COLUMN IF EXISTS category;

ALTER TABLE image_search.image_metadata
  ADD COLUMN IF NOT EXISTS "categoryId" VARCHAR,
  ADD COLUMN IF NOT EXISTS "subcategoryId" VARCHAR;

CREATE INDEX IF NOT EXISTS image_metadata_category_id_idx ON image_search.image_metadata ("categoryId");
CREATE INDEX IF NOT EXISTS image_metadata_subcategory_id_idx ON image_search.image_metadata ("subcategoryId");
