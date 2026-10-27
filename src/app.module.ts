import { Module } from '@nestjs/common';
import { PostgresService } from './infrastructure/database/postgres.service';
import { ProcessWagerUseCase } from './application/use-cases/process-wager.use-case';
import { WagerController } from './application/wager.controller';

@Module({
  imports: [],
  controllers: [WagerController],
  providers: [PostgresService, ProcessWagerUseCase],
})
export class AppModule {}