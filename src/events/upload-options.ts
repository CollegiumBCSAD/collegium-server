import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';

const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png'];

export const DOCUMENT_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, accept: boolean) => void,
  ) => {
    const accepted = ACCEPTED.includes(file.mimetype);
    callback(
      accepted
        ? null
        : new BadRequestException('Upload a PDF, JPEG, or PNG file'),
      accepted,
    );
  },
};
