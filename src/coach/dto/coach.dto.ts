import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  GameTitle,
  PracticeRecordSource,
  PracticeResult,
} from '@prisma/client';

export class CreateCoachTeamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;

  @IsEnum(GameTitle)
  gameTitle!: GameTitle;
}

export class InviteCoachDto {
  @IsEmail()
  email!: string;
}

export class ReviewCoachApplicationDto {
  @IsBoolean()
  approve!: boolean;
}

export class CreatePracticeScheduleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title!: string;

  @IsDateString()
  startsAt!: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdatePracticeScheduleDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreatePracticeRecordDto {
  @IsOptional()
  @IsUUID()
  scheduleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  opponentName?: string;

  @IsEnum(PracticeResult)
  result!: PracticeResult;

  @IsBoolean()
  completed!: boolean;

  @IsEnum(PracticeRecordSource)
  source!: PracticeRecordSource;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  ocrConfidence?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsDateString()
  playedAt?: string;
}
