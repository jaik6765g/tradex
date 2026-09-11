import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const ADMIN_USER_STATUSES = ['active', 'inactive', 'blocked'] as const;
export type AdminUserStatus = (typeof ADMIN_USER_STATUSES)[number];

export class AdminListUsersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  @IsIn(ADMIN_USER_STATUSES)
  status?: AdminUserStatus;
}
