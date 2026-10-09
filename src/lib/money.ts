import DecimalBase from "decimal.js";

/** Private Decimal configuration: high precision, Norwegian commercial rounding (half up). */
const Decimal = DecimalBase.clone({ precision: 40, rounding: DecimalBase.ROUND_HALF_UP });
type Decimal = InstanceType<typeof Decimal>;

const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * Exact money amount in NOK (or another currency later). Never constructed from a JS number,
 * so floating point errors cannot creep in. Arithmetic keeps full precision; call round()
 * where a rule says an amount is rounded (for example per invoice line), and toDb() refuses
 * values with more than two decimals so rounding is always an explicit decision.
 */
export class Money {
  private constructor(private readonly d: Decimal) {}

  static of(value: string | bigint): Money {
    if (typeof value === "bigint") return new Money(new Decimal(value.toString()));
    const v = value.trim();
    if (!NUMERIC_PATTERN.test(v)) throw new Error(`Invalid money amount: "${value}"`);
    return new Money(new Decimal(v));
  }

  /** Parses user input such as "1 234,50" or "1234.5". */
  static parse(input: string): Money {
    const cleaned = input.replace(/kr\.?/gi, "").replace(/[\s ]/g, "").replace(",", ".");
    return Money.of(cleaned);
  }

  static fromOre(ore: bigint): Money {
    return new Money(new Decimal(ore.toString()).div(100));
  }

  static zero(): Money {
    return new Money(new Decimal(0));
  }

  static sum(values: Iterable<Money>): Money {
    let total = new Decimal(0);
    for (const v of values) total = total.plus(v.d);
    return new Money(total);
  }

  add(o: Money): Money {
    return new Money(this.d.plus(o.d));
  }

  sub(o: Money): Money {
    return new Money(this.d.minus(o.d));
  }

  /** Multiply by a quantity or rate given as an exact decimal string, e.g. "1.5" or "0.25". */
  mul(factor: string): Money {
    if (!NUMERIC_PATTERN.test(factor)) throw new Error(`Invalid factor: "${factor}"`);
    return new Money(this.d.times(factor));
  }

  /** Percentage of this amount, e.g. pct("25") for 25 % MVA. Unrounded. */
  pct(percent: string): Money {
    return this.mul(percent).divideBy("100");
  }

  private divideBy(divisor: string): Money {
    return new Money(this.d.div(divisor));
  }

  negate(): Money {
    return new Money(this.d.negated());
  }

  /** Rounds to whole øre (2 decimals), half up. */
  round(): Money {
    return new Money(this.d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
  }

  /** Splits into parts proportional to weights without losing or inventing an øre. */
  allocate(weights: number[]): Money[] {
    if (!weights.length || weights.some((w) => !Number.isInteger(w) || w < 0)) {
      throw new Error("allocate() needs non-negative integer weights");
    }
    const total = weights.reduce((a, b) => a + b, 0);
    if (total === 0) throw new Error("allocate() weights sum to zero");
    const ore = this.round().d.times(100);
    const parts = weights.map((w) => ore.times(w).div(total).toDecimalPlaces(0, Decimal.ROUND_DOWN));
    let remainder = ore.minus(parts.reduce((a, b) => a.plus(b), new Decimal(0)));
    const step = remainder.isNegative() ? -1 : 1;
    for (let i = 0; !remainder.isZero(); i = (i + 1) % parts.length) {
      parts[i] = parts[i].plus(step);
      remainder = remainder.minus(step);
    }
    return parts.map((p) => new Money(p.div(100)));
  }

  isZero(): boolean {
    return this.d.isZero();
  }

  isNegative(): boolean {
    return this.d.isNegative() && !this.d.isZero();
  }

  equals(o: Money): boolean {
    return this.d.equals(o.d);
  }

  compare(o: Money): -1 | 0 | 1 {
    return this.d.comparedTo(o.d) as -1 | 0 | 1;
  }

  /** Value for a NUMERIC(18,2) column. Throws if it has not been rounded. */
  toDb(): string {
    if (this.d.decimalPlaces() > 2) throw new Error(`Amount ${this.d.toString()} must be rounded before storing`);
    return this.d.toFixed(2);
  }

  toString(): string {
    return this.d.toFixed();
  }

  /** "1 234,50 kr" style formatting. Uses Intl's exact decimal-string support, no float conversion. */
  format(locale: "nb" | "en" = "nb", currency = "NOK"): string {
    const fmt = new Intl.NumberFormat(locale === "nb" ? "nb-NO" : "en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return fmt.format(this.round().d.toFixed(2) as unknown as number);
  }
}
