-- This database is shared with Strapi. Strapi's own schema-sync only looks at
-- the `public` schema and was dropping our `image_metadata`/`fabric` tables
-- because it didn't recognize them. Isolating our tables in a dedicated
-- schema makes them invisible to Strapi's schema sync, while cross-schema
-- raw SQL joins against Strapi's tables (fabrics, files, categories, ...)
-- keep working unqualified via search_path (see app.module.ts).
--
-- Run this once, before starting the app against this database.

CREATE SCHEMA IF NOT EXISTS image_search;

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- If image_metadata/fabric still exist in `public` from before this fix,
-- move them into the new schema instead of losing/recreating them.
ALTER TABLE IF EXISTS public.image_metadata SET SCHEMA image_search;
ALTER TABLE IF EXISTS public.fabric SET SCHEMA image_search;
