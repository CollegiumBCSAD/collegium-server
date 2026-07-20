import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CreateUniversityDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^[a-zA-Z0-9.-]+\.edu\.ph$/, {
    message: 'Domain must be a valid .edu.ph domain (e.g., admu.edu.ph)',
  })
  domain: string;
}
