import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export const BELOW_MINIMUM_REVIEW_DECISIONS = ['CREDIT', 'REJECT'] as const;

/**
 * Authorized admin decision for a BELOW_MINIMUM on-chain deposit
 * (Architecture Plan v3, correction 2). Reason is mandatory and is
 * persisted in the immutable admin_audit_logs row.
 */
export class ReviewBelowMinimumDepositDto {
  @IsString()
  @IsIn(BELOW_MINIMUM_REVIEW_DECISIONS)
  decision: (typeof BELOW_MINIMUM_REVIEW_DECISIONS)[number];

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
