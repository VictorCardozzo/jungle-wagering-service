import Decimal from 'decimal.js';

export interface MoneyProps {
  amount: string;   // decimal string, ex.: "25.00"
  currency: string; // ISO-4217, ex.: "BRL"
}

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    if (!props || !props.amount || typeof props.amount !== 'string') {
      throw new Error('O valor de amount deve ser uma string decimal.');
    }

    const trimmedAmount = props.amount.trim();

    // Rejeita notação científica, strings vazias, NaN e mais de 2 casas decimais
    if (!/^-?\d+(\.\d{1,2})?$/.test(trimmedAmount)) {
      throw new Error('Formato monetário inválido. Exige-se string decimal com no máximo 2 casas.');
    }

    const decimalValue = new Decimal(trimmedAmount);

    if (!decimalValue.isFinite()) {
      throw new Error('Valor monetário inválido: NaN ou Infinity.');
    }

    return new Money(decimalValue, props.currency.toUpperCase());
  }

  static zero(currency: string): Money {
    return new Money(new Decimal('0.00'), currency.toUpperCase());
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return {
      amount: this.value.toFixed(2),
      currency: this.currency,
    };
  }

  toString(): string {
    return `${this.value.toFixed(2)} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Conflito de moeda: ${this.currency} vs ${other.currency}`);
    }
  }
}