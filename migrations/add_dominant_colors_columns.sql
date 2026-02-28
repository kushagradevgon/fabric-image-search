-- Add LAB color columns for strict fabric search (run if not using TypeORM synchronize)
-- Ensure embedding column exists (vector type) - create extension and column if needed.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE image_metadata
ADD COLUMN IF NOT EXISTS dominant_colors_rgb JSONB,
ADD COLUMN IF NOT EXISTS dominant_colors_lab JSONB;
