import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateUniversityDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9.-]+\.edu\.ph$/, {
    message: 'Domain must be a valid .edu.ph domain (e.g., admu.edu.ph)',
  })
  domain?: string;
}
