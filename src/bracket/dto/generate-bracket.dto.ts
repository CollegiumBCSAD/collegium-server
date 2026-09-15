import {
  IsArray,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export enum SeedingMode {
  MANUAL = 'MANUAL',
  RANDOM = 'RANDOM',
}

export class GenerateBracketDto {
  @IsOptional()
  @IsEnum(SeedingMode)
  seedingMode?: SeedingMode = SeedingMode.RANDOM;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  seeds?: string[];

  @IsOptional()
  @IsNumber()
  @Min(1.0)
  @Max(2.0)
  eventWeightOverride?: number;

  @IsOptional()
  @IsObject()
  bestOfOverrides?: Record<string, number>;
}
