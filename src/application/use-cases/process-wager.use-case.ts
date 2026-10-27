import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PostgresService } from '../../infrastructure/database/postgres.service';
import { Money } from '../../domain/money.value-object';
import { Wallet } from '../../domain/wallet.entity';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  FailureCode,
} from '../../domain/wager-transaction.entity';
import { WalletLedgerEntry, LedgerDirection } from '../../domain/wallet-ledger-entry.entity';
import { OutboxMessage } from '../../domain/outbox-message.entity';

export interface ProcessWagerInput {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: { amount: string; currency: string };
  referenceExternalTransactionId?: string;
  messageId?: string;
}

export interface ProcessWagerOutput {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: { amount: string; currency: string };
  idempotentReplay: boolean;
}

@Injectable()
export class ProcessWagerUseCase {
  constructor(private readonly postgres: PostgresService) {}

  async execute(input: ProcessWagerInput): Promise<ProcessWagerOutput> {
    const payloadHash = this.computePayloadHash(input);

    return await this.postgres.transaction(async (client) => {
      // 1. DEDUPLICAÇÃO DE INBOX (se recebido via SQS)
      if (input.messageId) {
        const inboxRes = await client.query(
          `SELECT processed_at FROM inbox_messages WHERE consumer_name = $1 AND message_id = $2`,
          ['wager-consumer', input.messageId],
        );

        if (inboxRes.rows.length > 0 && inboxRes.rows[0].processed_at) {
          const txRes = await client.query(
            `SELECT id, status FROM wager_transactions WHERE idempotency_key = $1`,
            [input.idempotencyKey],
          );
          const walletRes = await client.query(
            `SELECT balance_amount, currency FROM wallets WHERE id = $1`,
            [input.walletId],
          );
          return {
            transactionId: txRes.rows[0].id,
            status: txRes.rows[0].status,
            balance: {
              amount: Number(walletRes.rows[0].balance_amount).toFixed(2),
              currency: walletRes.rows[0].currency,
            },
            idempotentReplay: true,
          };
        }
      }

      // 2. IDEMPOTÊNCIA PERSISTENTE
      const existingTxRes = await client.query(
        `SELECT id, status, payload_hash FROM wager_transactions WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );

      if (existingTxRes.rows.length > 0) {
        const existingTx = existingTxRes.rows[0];
        if (existingTx.payload_hash !== payloadHash) {
          throw new Error('IDEMPOTENCY_PAYLOAD_MISMATCH');
        }

        const walletRes = await client.query(
          `SELECT balance_amount, currency FROM wallets WHERE id = $1`,
          [input.walletId],
        );

        return {
          transactionId: existingTx.id,
          status: existingTx.status,
          balance: {
            amount: Number(walletRes.rows[0].balance_amount).toFixed(2),
            currency: walletRes.rows[0].currency,
          },
          idempotentReplay: true,
        };
      }

      // 3. LOCK PESSIMISTA NA WALLET (SELECT ... FOR UPDATE)
      const walletRes = await client.query(
        `SELECT id, player_id, currency, balance_amount, version, created_at, updated_at 
         FROM wallets WHERE id = $1 FOR UPDATE`,
        [input.walletId],
      );

      if (walletRes.rows.length === 0) {
        throw new Error('WALLET_NOT_FOUND');
      }

      const walletRow = walletRes.rows[0];
      const wallet = Wallet.rehydrate({
        id: walletRow.id,
        playerId: walletRow.player_id,
        currency: walletRow.currency,
        balance: Money.from({
          amount: Number(walletRow.balance_amount).toFixed(2),
          currency: walletRow.currency,
        }),
        version: walletRow.version,
        createdAt: new Date(walletRow.created_at),
        updatedAt: new Date(walletRow.updated_at),
      });

      const money = Money.from(input.money);

      // 4. INSTANCIAR A TRANSAÇÃO
      const tx = WagerTransaction.create({
        providerId: input.providerId,
        externalTransactionId: input.externalTransactionId,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        walletId: input.walletId,
        playerId: input.playerId,
        roundId: input.roundId,
        gameId: input.gameId,
        kind: input.kind,
        money,
        referenceExternalTransactionId: input.referenceExternalTransactionId,
      });

      // 5. PROCESSAR REGRAS DE NEGÓCIO E SALDO
      let ledgerDirection: LedgerDirection | null = null;
      const balanceBefore = wallet.balance;

      switch (tx.kind) {
        case WagerTransactionKind.Bet:
          if (wallet.balance.isLessThan(money)) {
            tx.reject(FailureCode.INSUFFICIENT_FUNDS);
          } else {
            wallet.debit(money);
            ledgerDirection = LedgerDirection.Debit;
            tx.markProcessed(undefined);
          }
          break;

        case WagerTransactionKind.Win:
          wallet.credit(money);
          ledgerDirection = LedgerDirection.Credit;
          tx.markProcessed(undefined);
          break;

        case WagerTransactionKind.Loss:
          tx.markProcessed(undefined); // Não move saldo nem gera ledger
          break;

        default:
          tx.reject(FailureCode.INTERNAL_ERROR);
      }

      // 6. SALVAR TRANSAÇÃO NO BANCO
      await client.query(
        `INSERT INTO wager_transactions 
        (id, provider_id, external_transaction_id, idempotency_key, payload_hash, wallet_id, player_id, round_id, game_id, kind, amount, currency, reference_external_transaction_id, status, failure_code, created_at, processed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          tx.id,
          tx.providerId,
          tx.externalTransactionId,
          tx.idempotencyKey,
          tx.payloadHash,
          tx.walletId,
          tx.playerId,
          tx.roundId,
          tx.gameId,
          tx.kind,
          money.toJSON().amount,
          money.currency,
          tx.referenceExternalTransactionId || null,
          tx.status,
          tx.failureCode || null,
          tx.createdAt,
          tx.processedAt || null,
        ],
      );

      // 7. SE FOI PROCESSADA COM ALTERAÇÃO DE SALDO, GRAVAR LEDGER E OUTBOX
      if (tx.status === WagerTransactionStatus.Processed && ledgerDirection) {
        // Atualiza a Wallet
        await client.query(
          `UPDATE wallets SET balance_amount = $1, version = version + 1, updated_at = NOW() WHERE id = $2`,
          [wallet.balance.toJSON().amount, wallet.id],
        );

        // Grava Entrada no Ledger Imutável
        const ledgerEntry = WalletLedgerEntry.create({
          walletId: wallet.id,
          transactionId: tx.id,
          direction: ledgerDirection,
          money,
          balanceBefore,
          balanceAfter: wallet.balance,
        });

        await client.query(
          `INSERT INTO wallet_ledger_entries 
          (id, wallet_id, transaction_id, direction, amount, currency, balance_before, balance_after, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            ledgerEntry.id,
            ledgerEntry.walletId,
            ledgerEntry.transactionId,
            ledgerEntry.direction,
            ledgerEntry.money.toJSON().amount,
            ledgerEntry.money.currency,
            ledgerEntry.balanceBefore.toJSON().amount,
            ledgerEntry.balanceAfter.toJSON().amount,
            ledgerEntry.createdAt,
          ],
        );

        // Grava Evento na Tabela de Outbox
        const outbox = OutboxMessage.enqueue(wallet.id, 'WalletBalanceChanged', {
          walletId: wallet.id,
          transactionId: tx.id,
          balance: wallet.balance.toJSON(),
        });

        await client.query(
          `INSERT INTO outbox_messages (id, aggregate_id, event_type, payload, occurred_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [outbox.id, outbox.aggregateId, outbox.eventType, JSON.stringify(outbox.payload), outbox.occurredAt],
        );
      }

      // Se veio via SQS, marca o Inbox como processado
      if (input.messageId) {
        await client.query(
          `INSERT INTO inbox_messages (message_id, consumer_name, payload_hash, processed_at)
           VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING`,
          [input.messageId, 'wager-consumer', payloadHash],
        );
      }

      return {
        transactionId: tx.id,
        status: tx.status,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
      };
    });
  }

  private computePayloadHash(input: ProcessWagerInput): string {
    const canonicalPayload = JSON.stringify({
      externalTransactionId: input.externalTransactionId,
      gameId: input.gameId,
      kind: input.kind,
      money: { amount: input.money.amount, currency: input.money.currency },
      playerId: input.playerId,
      providerId: input.providerId,
      referenceExternalTransactionId: input.referenceExternalTransactionId || null,
      roundId: input.roundId,
      walletId: input.walletId,
    });

    return createHash('sha256').update(canonicalPayload).digest('hex');
  }
}