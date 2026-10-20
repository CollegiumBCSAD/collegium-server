import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { Role } from '@prisma/client';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(72, { message: 'Password must be at most 72 characters.' })
  @Matches(/[A-Za-z]/, { message: 'Password must contain a letter.' })
  @Matches(/\d/, { message: 'Password must contain a number.' })
  password: string;

  @IsString()
  displayName: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
