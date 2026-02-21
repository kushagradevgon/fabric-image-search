import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Fabric } from './fabric.entity';
import { FabricService } from './fabric.service';

@Module({
  imports: [TypeOrmModule.forFeature([Fabric])],
  providers: [FabricService],
  exports: [TypeOrmModule, FabricService],
})
export class FabricModule {}
