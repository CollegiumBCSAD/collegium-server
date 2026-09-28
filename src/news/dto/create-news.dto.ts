import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { GameTitle, NewsCategory, NewsStatus } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const toBoolean = ({ value }: { value: unknown }) => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

export class CreateNewsDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  title: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  excerpt: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  body: string;

  @IsEnum(NewsCategory)
  category: NewsCategory;

  @IsOptional()
  @Transform(emptyToNull)
  @IsEnum(GameTitle)
  gameTitle?: GameTitle | null;

  @IsOptional()
  @IsEnum(NewsStatus)
  status?: NewsStatus;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isFeatured?: boolean;
}
