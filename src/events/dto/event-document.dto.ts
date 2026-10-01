import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { EventDocumentKind } from '@prisma/client';

export class UploadEventDocumentDto {
  @IsString()
  @IsNotEmpty()
  rosterPlayerId!: string;

  @IsEnum(EventDocumentKind)
  kind!: EventDocumentKind;
}
