import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsEmail } from 'class-validator';

export class AllowedEmailsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsEmail({}, { each: true })
  emails: string[];
}
