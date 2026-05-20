// image-metadata/image-metadata.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('image_metadata')
export class ImageMetadata {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  entityType: string; // FABRIC

  @Column()
  entityId: string; // fabric_id

  @Column()
  imageUrl: string;

  @Column({ nullable: true })
  categoryId: string | null;

  @Column({ nullable: true })
  subcategoryId: string | null;

  @Column({ type: 'jsonb' })
  tags: string[];

  @Column({ type: 'jsonb', nullable: true })
  rawLabels: any;

  @Column({ type: 'jsonb', nullable: true })
  provider_metadata: {
    pattern?: string;
    pattern_detail?: string;
    weave?: string;
    weave_detail?: string;
    stripe_width?: string;
    fabricType?: string;
    fabric_coverage?: number;
    colors?: string[];
    dominantColor?: string;
    baseColor?: string;
    accentColor?: string;
    palette?: string[];
    distribution?: Record<string, number>;
    confidence?: number;
    hash?: string;
    indexStatus?: 'indexed' | 'rejected_not_fabric';
  } | null;

  @Column('vector', { length: 768, nullable: true })
  embedding: number[] | null;

  @Column({ type: 'jsonb', nullable: true })
  dominant_colors_rgb: { r: number; g: number; b: number }[] | null;

  @Column({ type: 'jsonb', nullable: true })
  dominant_colors_lab: { l: number; a: number; b: number }[] | null;

  @Index()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}

