import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  PULSE_MAX_TRADE_AMOUNT_TDX,
  PULSE_MIN_TRADE_AMOUNT_TDX,
  isSupportedPulseDuration,
  isSupportedPulsePair,
} from '../constants/trade-config';

export interface LiquidityCheckInput {
  pair: string;
  amount: string;
  duration: number;
  availableLiquidity?: string;
  reservedLiquidity?: string;
  currentPayoutExposure?: string;
  currentPairExposure?: string;
  limits?: {
    maxUtilizationPercent?: string;
    maxPayoutExposure?: string;
    maxPairExposure?: string;
  };
}

export interface LiquidityCheckResult {
  approved: boolean;
  reason?: string;
  openDecisions: string[];
}

@Injectable()
export class LiquidityService {
  private static readonly DEFAULT_MAX_UTILIZATION_PERCENT = new Decimal('80');
  private static readonly DEFAULT_MAX_PAYOUT_EXPOSURE = new Decimal('120000');
  private static readonly DEFAULT_MAX_PAIR_EXPOSURE = new Decimal('50000');

  async checkTradeLiquidity(
    input: LiquidityCheckInput,
  ): Promise<LiquidityCheckResult> {
    if (!isSupportedPulsePair(input.pair)) {
      return {
        approved: false,
        reason: `Unsupported pulse pair: ${input.pair}`,
        openDecisions: [],
      };
    }

    if (!isSupportedPulseDuration(input.duration)) {
      return {
        approved: false,
        reason: `Unsupported pulse duration: ${input.duration}`,
        openDecisions: [],
      };
    }

    const amount = new Decimal(input.amount);
    if (!amount.isFinite() || amount.lte(0)) {
      return {
        approved: false,
        reason: 'Trade amount must be greater than zero',
        openDecisions: [],
      };
    }

    const minAmount = new Decimal(PULSE_MIN_TRADE_AMOUNT_TDX);
    const maxAmount = new Decimal(PULSE_MAX_TRADE_AMOUNT_TDX);

    if (amount.lt(minAmount) || amount.gt(maxAmount)) {
      return {
        approved: false,
        reason: `Trade amount must be between ${PULSE_MIN_TRADE_AMOUNT_TDX} and ${PULSE_MAX_TRADE_AMOUNT_TDX} TDX`,
        openDecisions: [],
      };
    }

    const availableLiquidity = this.resolveNonNegativeDecimal(
      input.availableLiquidity,
      '0',
    );
    const reservedLiquidity = this.resolveNonNegativeDecimal(
      input.reservedLiquidity,
      '0',
    );

    if (availableLiquidity.lte(0)) {
      return {
        approved: false,
        reason: 'LIQUIDITY_LIMIT_REACHED: No available liquidity',
        openDecisions: [],
      };
    }

    const projectedReservedLiquidity = reservedLiquidity.plus(amount);
    const totalLiquidity = availableLiquidity.plus(reservedLiquidity);
    const maxUtilizationPercent = this.resolvePositiveLimit(
      input.limits?.maxUtilizationPercent,
      LiquidityService.DEFAULT_MAX_UTILIZATION_PERCENT,
    );

    const utilizationPercent = projectedReservedLiquidity
      .mul(100)
      .div(totalLiquidity);

    if (utilizationPercent.gt(maxUtilizationPercent)) {
      return {
        approved: false,
        reason: `LIQUIDITY_LIMIT_REACHED: Utilization would exceed ${maxUtilizationPercent.toFixed(18)}%`,
        openDecisions: [],
      };
    }

    const projectedPayoutExposure = this.resolveNonNegativeDecimal(
      input.currentPayoutExposure,
      '0',
    ).plus(amount);
    const maxPayoutExposure = this.resolvePositiveLimit(
      input.limits?.maxPayoutExposure,
      LiquidityService.DEFAULT_MAX_PAYOUT_EXPOSURE,
    );
    if (projectedPayoutExposure.gt(maxPayoutExposure)) {
      return {
        approved: false,
        reason: `LIQUIDITY_LIMIT_REACHED: Payout exposure would exceed ${maxPayoutExposure.toFixed(18)} TDX`,
        openDecisions: [],
      };
    }

    const projectedPairExposure = this.resolveNonNegativeDecimal(
      input.currentPairExposure,
      '0',
    ).plus(amount);
    const maxPairExposure = this.resolvePositiveLimit(
      input.limits?.maxPairExposure,
      LiquidityService.DEFAULT_MAX_PAIR_EXPOSURE,
    );
    if (projectedPairExposure.gt(maxPairExposure)) {
      return {
        approved: false,
        reason: `LIQUIDITY_LIMIT_REACHED: Pair exposure would exceed ${maxPairExposure.toFixed(18)} TDX`,
        openDecisions: [],
      };
    }

    return {
      approved: true,
      openDecisions: [],
    };
  }

  private resolveNonNegativeDecimal(
    value: string | undefined,
    fallback: string,
  ): Decimal {
    const parsed = new Decimal(value ?? fallback);
    if (!parsed.isFinite() || parsed.lt(0)) {
      return new Decimal(fallback);
    }
    return parsed;
  }

  private resolvePositiveLimit(
    value: string | undefined,
    fallback: Decimal,
  ): Decimal {
    if (value === undefined) {
      return fallback;
    }

    const parsed = new Decimal(value);
    if (!parsed.isFinite() || parsed.lte(0)) {
      return fallback;
    }

    return parsed;
  }
}
