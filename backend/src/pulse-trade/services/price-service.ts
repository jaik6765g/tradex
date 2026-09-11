import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Decimal from 'decimal.js';
import {
  isSupportedPulsePair,
  PulseSupportedPair,
} from '../constants/trade-config';

export const PULSE_MARKET_PRICE_PROVIDERS = Symbol(
  'PULSE_MARKET_PRICE_PROVIDERS',
);

export interface ProviderPriceSample {
  pair: PulseSupportedPair;
  source: string;
  price: string;
  timestamp: Date;
  receivedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface MarketPriceProvider {
  readonly source: string;
  fetchPrice(pair: PulseSupportedPair): Promise<ProviderPriceSample>;
}

export interface AuthoritativePriceIndex {
  pair: PulseSupportedPair;
  indexPrice: string;
  calculatedAt: Date;
  aggregationMethod: 'SIMPLE_AVERAGE';
  sourcesUsed: string[];
  providerSamples: Array<{
    source: string;
    price: string;
    timestamp: Date;
  }>;
  rejectedSources: Array<{
    source: string;
    reason: string;
  }>;
  openDecisions: string[];
}

@Injectable()
export class BinancePriceProvider implements MarketPriceProvider {
  readonly source = 'BINANCE';

  constructor(private readonly configService: ConfigService) {}

  async fetchPrice(pair: PulseSupportedPair): Promise<ProviderPriceSample> {
    const symbol = pair.replace('/', '');
    const baseUrl =
      this.configService.get<string>('PULSE_BINANCE_PRICE_URL') ||
      'https://api.binance.com/api/v3/ticker/price';
    const requestUrl = `${baseUrl}?symbol=${symbol}`;

    let response: Response;
    try {
      response = await fetch(requestUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `Binance price request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Binance price request failed with status ${response.status}`,
      );
    }

    const payload = (await response.json()) as {
      symbol?: unknown;
      price?: unknown;
    };

    if (typeof payload?.price !== 'string') {
      throw new UnprocessableEntityException(
        'Binance response missing string price',
      );
    }

    const receivedAt = new Date();

    return {
      pair,
      source: this.source,
      price: payload.price,
      timestamp: receivedAt,
      receivedAt,
      metadata: {
        providerSymbol: payload.symbol,
        timestampSource: 'RECEIVED_AT',
      },
    };
  }
}

@Injectable()
export class PriceService {
  constructor(
    @Inject(PULSE_MARKET_PRICE_PROVIDERS)
    private readonly providers: MarketPriceProvider[],
    private readonly configService: ConfigService,
  ) {}

  async getAuthoritativePriceIndex(
    pair: string,
  ): Promise<AuthoritativePriceIndex> {
    this.ensureSupportedPair(pair);

    const supportedPair = pair;
    if (this.providers.length === 0) {
      throw new ServiceUnavailableException(
        'No market price providers are configured',
      );
    }

    const settledResults = await Promise.allSettled(
      this.providers.map((provider) => provider.fetchPrice(supportedPair)),
    );

    const staleThresholdMs = this.getStaleThresholdMs();
    const now = new Date();

    const validSamples: ProviderPriceSample[] = [];
    const rejectedSources: Array<{ source: string; reason: string }> = [];

    settledResults.forEach((result, index) => {
      const source = this.providers[index].source;

      if (result.status === 'rejected') {
        rejectedSources.push({
          source,
          reason:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        });
        return;
      }

      try {
        this.validateProviderSample(
          result.value,
          supportedPair,
          staleThresholdMs,
          now,
        );
        validSamples.push(result.value);
      } catch (error) {
        rejectedSources.push({
          source,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    });

    if (validSamples.length === 0) {
      throw new ServiceUnavailableException(
        'No valid provider prices are available',
      );
    }

    const aggregationMethod = this.getAggregationMethod();
    if (aggregationMethod !== 'SIMPLE_AVERAGE') {
      throw new ServiceUnavailableException(
        `OPEN DECISION: aggregation method ${aggregationMethod} is not implemented`,
      );
    }

    const aggregatedPrice = validSamples
      .reduce(
        (sum, sample) => sum.plus(new Decimal(sample.price)),
        new Decimal(0),
      )
      .div(new Decimal(validSamples.length));

    return {
      pair: supportedPair,
      indexPrice: aggregatedPrice.toFixed(18),
      calculatedAt: now,
      aggregationMethod: 'SIMPLE_AVERAGE',
      sourcesUsed: validSamples.map((sample) => sample.source),
      providerSamples: validSamples.map((sample) => ({
        source: sample.source,
        price: new Decimal(sample.price).toFixed(18),
        timestamp: sample.timestamp,
      })),
      rejectedSources,
      openDecisions: [
        'Aggregation weighting formula remains configuration-driven and is not defined beyond deterministic aggregation in current docs.',
      ],
    };
  }

  private ensureSupportedPair(
    pair: string,
  ): asserts pair is PulseSupportedPair {
    if (!isSupportedPulsePair(pair)) {
      throw new BadRequestException(`Unsupported pulse pair: ${pair}`);
    }
  }

  private validateProviderSample(
    sample: ProviderPriceSample,
    expectedPair: PulseSupportedPair,
    staleThresholdMs: number,
    now: Date,
  ): void {
    if (!sample) {
      throw new UnprocessableEntityException('Missing provider sample');
    }

    if (sample.pair !== expectedPair) {
      throw new UnprocessableEntityException(
        'Provider returned mismatched pair',
      );
    }

    if (
      !(sample.timestamp instanceof Date) ||
      Number.isNaN(sample.timestamp.getTime())
    ) {
      throw new UnprocessableEntityException(
        'Provider sample has invalid timestamp',
      );
    }

    const price = new Decimal(sample.price);
    if (!price.isFinite() || price.lte(0)) {
      throw new UnprocessableEntityException(
        'Provider sample has invalid price',
      );
    }

    const sampleAgeMs = now.getTime() - sample.timestamp.getTime();
    if (sampleAgeMs > staleThresholdMs) {
      throw new UnprocessableEntityException('Provider sample is stale');
    }
  }

  private getStaleThresholdMs(): number {
    const configured =
      this.configService.get<string>('PULSE_PRICE_STALE_THRESHOLD_MS') ||
      '15000';
    const parsed = Number.parseInt(configured, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 15000;
    }
    return parsed;
  }

  private getAggregationMethod(): string {
    return (
      this.configService.get<string>('PULSE_PRICE_AGGREGATION_METHOD') ||
      'SIMPLE_AVERAGE'
    ).toUpperCase();
  }
}
