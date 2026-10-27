import { Controller, Post, Body, HttpCode, HttpStatus, BadRequestException, ConflictException } from '@nestjs/common';
import { ProcessWagerUseCase } from './use-cases/process-wager.use-case';
import { WagerTransactionKind } from '../domain/wager-transaction.entity';

export interface ProcessWagerDto {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: {
    amount: string;
    currency: string;
  };
  referenceExternalTransactionId?: string;
}

@Controller('v1/wagers')
export class WagerController {
  constructor(private readonly processWagerUseCase: ProcessWagerUseCase) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async processWager(@Body() dto: ProcessWagerDto) {
    try {
      const result = await this.processWagerUseCase.execute(dto);
      return {
        transactionId: result.transactionId,
        status: result.status,
        balance: result.balance,
        idempotentReplay: result.idempotentReplay,
      };
    } catch (error: any) {
      if (error.message === 'IDEMPOTENCY_PAYLOAD_MISMATCH') {
        throw new ConflictException('A chave de idempotência já foi utilizada com um payload diferente.');
      }
      if (error.message === 'WALLET_NOT_FOUND') {
        throw new BadRequestException('Carteira não encontrada.');
      }
      throw new BadRequestException(error.message || 'Erro ao processar transação.');
    }
  }
}