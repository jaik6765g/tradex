import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  PULSE_MAX_TRADE_AMOUNT_TDX,
  PULSE_MIN_TRADE_AMOUNT_TDX,
  isSupportedPulseDuration,
  isSupportedPulsePair,
} from '../constants/trade-config';

export interface RiskCheckInput {
  userId: string;
  pair: string;
  amount: string;
  duration: number;
  currentTotalExposure?: string;
  currentPairExposure?: string;
  currentDurationExposure?: string;
  currentUserExposure?: string;
  limits?: {
    maxTotalExposure?: string;
    maxPairExposure?: string;
    maxDurationExposure?: string;
    maxUserExposure?: string;
  };
}

export interface RiskCheckResult {
  approved: boolean;
  reason?: string;
  openDecisions: string[];
}

@Injectable()
export class RiskService {
  private static readonly DEFAULT_LIMITS = {
    maxTotalExposure: new Decimal('100000'),
    maxPairExposure: new Decimal('40000'),
    maxDurationExposure: new Decimal('30000'),
    maxUserExposure: new Decimal('15000'),
  };

  async evaluatePreTradeRisk(input: RiskCheckInput): Promise<RiskCheckResult> {
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

    const resolvedLimits = this.resolveLimits(input.limits);
    const projectedTotalExposure = this.resolveExposure(
      input.currentTotalExposure,
    ).plus(amount);
    if (projectedTotalExposure.gt(resolvedLimits.maxTotalExposure)) {
      return {
        approved: false,
        reason: `RISK_LIMIT_REACHED: Total exposure would exceed ${resolvedLimits.maxTotalExposure.toFixed(18)} TDX`,
        openDecisions: [],
      };
    }

    const projectedPairExposure = this.resolveExposure(
      input.currentPairExposure,
    ).plus(amount);
    if (projectedPairExposure.gt(resolvedLimits.maxPairExposure)) {
      return {
        approved: false,
        reason: `RISK_LIMIT_REACHED: Pair exposure would exceed ${resolvedLimits.maxPairExposure.toFixed(18)} TDX`,
        openDecisions: [],
      };
    }

    const projectedDurationExposure = this.resolveExposure(
      input.currentDurationExposure,
    ).plus(amount);
    if (projectedDurationExposure.gt(resolvedLimits.maxDurationExposure)) {
      return {
        approved: false,
        reason: `RISK_LIMIT_REACHED: Duration exposure would exceed ${resolvedLimits.maxDurationExposure.toFixed(18)} TDX`,
        openDecisions: [],
      };
    }

    const projectedUserExposure = this.resolveExposure(
      input.currentUserExposure,
    ).plus(amount);
    if (projectedUserExposure.gt(resolvedLimits.maxUserExposure)) {
      return {
        approved: false,
        reason: `RISK_LIMIT_REACHED: User exposure would exceed ${resolvedLimits.maxUserExposure.toFixed(18)} TDX`,
        openDecisions: [],
      };
    }

    return {
      approved: true,
      openDecisions: [],
    };
  }

  private resolveExposure(value?: string): Decimal {
    if (value === undefined) {
      return new Decimal(0);
    }

    const parsed = new Decimal(value);
    if (!parsed.isFinite() || parsed.lt(0)) {
      return new Decimal(0);
    }

    return parsed;
  }

  private resolveLimits(input?: RiskCheckInput['limits']) {
    return {
      maxTotalExposure: this.resolveLimit(
        input?.maxTotalExposure,
        RiskService.DEFAULT_LIMITS.maxTotalExposure,
      ),
      maxPairExposure: this.resolveLimit(
        input?.maxPairExposure,
        RiskService.DEFAULT_LIMITS.maxPairExposure,
      ),
      maxDurationExposure: this.resolveLimit(
        input?.maxDurationExposure,
        RiskService.DEFAULT_LIMITS.maxDurationExposure,
      ),
      maxUserExposure: this.resolveLimit(
        input?.maxUserExposure,
        RiskService.DEFAULT_LIMITS.maxUserExposure,
      ),
    };
  }

  private resolveLimit(value: string | undefined, fallback: Decimal): Decimal {
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
