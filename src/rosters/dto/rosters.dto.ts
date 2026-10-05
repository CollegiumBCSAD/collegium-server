import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { RosterChangeReason } from '@prisma/client';

export class UpdateRosterMemberDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  preferredRole?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  gameHandle?: string;
}

export class CreateRosterChangeDto {
  @IsUUID()
  applicationId!: string;

  @IsUUID()
  outUserId!: string;

  @IsUUID()
  inUserId!: string;

  @IsEnum(RosterChangeReason)
  reason!: RosterChangeReason;

  // A one-word excuse isn't a valid reason; ask for a real explanation.
  @IsString()
  @MinLength(15)
  @MaxLength(1000)
  details!: string;
}

export class ReviewRosterChangeDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
