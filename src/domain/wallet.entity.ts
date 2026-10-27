import { Money } from './money.value-object';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: {
    id: string;
    playerId: string;
    initialBalance: Money;
  }): Wallet {
    const now = new Date();
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1, // Version inicia em 1 após a criação
      now,
      now,
    );
  }

  /** Reconstrução a partir da persistência — não revalida transições de negócio */
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  credit(money: Money): void {
    this.assertSameCurrency(money);
    this._balance = this._balance.add(money);
    this._version += 1;
    this._updatedAt = new Date();
  }

  debit(money: Money): void {
    this.assertSameCurrency(money);
    if (this._balance.isLessThan(money)) {
      throw new Error('Saldo insuficiente para realizar o débito.');
    }
    this._balance = this._balance.subtract(money);
    this._version += 1;
    this._updatedAt = new Date();
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new Error(`Incompatibilidade de moedas: Wallet (${this.currency}) vs Operação (${money.currency}).`);
    }
  }
}