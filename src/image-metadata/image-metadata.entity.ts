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

  @Column({ type: 'jsonb' })
  tags: string[];

  @Column({ type: 'jsonb', nullable: true })
  rawLabels: any;

  @Column({ type: 'jsonb', nullable: true })
  provider_metadata: {
    pattern?: string;
    weave?: string;
    colors?: string[];
    fabricType?: string;
    confidence?: number;
    hash?: string;
  } | null;

  @Column('vector', { length: 768, nullable: true })
  embedding: number[] | null;

  @Index()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}

