import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EventTeamStatus } from '@prisma/client';

export class RosterPlayerDto {
  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  studentNumber!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  ign!: string;

  @IsBoolean()
  @IsOptional()
  isSubstitute?: boolean;
}

export class SubmitEventTeamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  captainName!: string;

  @IsEmail()
  captainEmail!: string;

  @IsArray()
  @ArrayMinSize(5)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RosterPlayerDto)
  roster!: RosterPlayerDto[];
}

export class UpdateEventTeamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  @IsOptional()
  name?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @IsOptional()
  captainName?: string;

  @IsEmail()
  @IsOptional()
  captainEmail?: string;

  @IsArray()
  @ArrayMinSize(5)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RosterPlayerDto)
  @IsOptional()
  roster?: RosterPlayerDto[];
}

export class ReviewEventTeamDto {
  @IsEnum(EventTeamStatus)
  status!: EventTeamStatus;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  reviewNote?: string;
}
