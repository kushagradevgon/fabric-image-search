import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity({ name: 'fabric', schema: 'image_search' })
export class Fabric {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  entityId: string;

  @Column()
  imageUrl: string;

  @Column()
  pattern: string;

  @Column()
  weave: string;

  @Column({ type: 'jsonb' })
  colors: string[];

  @Column()
  fabricType: string;

  @Column('float')
  confidence: number;

  @Column('vector', { length: 768 })
  embedding: number[];

  @Index()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
