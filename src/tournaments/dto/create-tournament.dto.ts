import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTournamentDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  bracketFormat?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  teamQuota?: number;

  @IsOptional()
  @IsString()
  rules?: string;
}
