import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class ClosePlayerStatDto {
  @IsUUID()
  universityId: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsInt()
  @Min(0)
  kills: number;

  @IsInt()
  @Min(0)
  deaths: number;

  @IsInt()
  @Min(0)
  assists: number;

  @IsOptional()
  @IsObject()
  extra?: Record<string, unknown>;
}

export class CloseMatchDto {
  @IsUUID()
  winnerId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ClosePlayerStatDto)
  players: ClosePlayerStatDto[];
}
