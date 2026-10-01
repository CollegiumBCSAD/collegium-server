import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventDocumentKind, EventTeamStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService, RequestingUser } from './events.service';
import { EventTeamsService } from './event-teams.service';

export const DOCUMENT_META_SELECT = {
  id: true,
  rosterPlayerId: true,
  kind: true,
  filename: true,
  mimeType: true,
  sizeBytes: true,
  uploadedAt: true,
};

type SniffedMime = 'application/pdf' | 'image/jpeg' | 'image/png';

@Injectable()
export class EventDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: EventsService,
    private readonly eventTeamsService: EventTeamsService,
  ) {}

  async uploadByEditToken(
    token: string,
    rosterPlayerId: string,
    kind: EventDocumentKind,
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file was uploaded');
    }

    const team = await this.prisma.eventTeam.findUnique({
      where: { editToken: token },
      include: { event: true },
    });

    if (!team) {
      throw new NotFoundException('Squad not found');
    }

    if (team.status === EventTeamStatus.APPROVED) {
      throw new ForbiddenException(
        'This squad has been approved and can no longer be edited',
      );
    }

    if (!this.eventsService.signupsOpen(team.event)) {
      throw new BadRequestException('Sign-ups are closed for this event');
    }

    const roster = this.eventTeamsService.readRoster(team);
    if (!roster.some((entry) => entry.id === rosterPlayerId)) {
      throw new NotFoundException('That player is not on this squad');
    }

    const mimeType = this.sniffMime(file.buffer);

    if (kind === EventDocumentKind.COR && mimeType !== 'application/pdf') {
      throw new BadRequestException(
        'A Certificate of Registration must be a PDF',
      );
    }

    return this.prisma.eventDocument.upsert({
      where: {
        teamId_rosterPlayerId_kind: { teamId: team.id, rosterPlayerId, kind },
      },
      create: {
        teamId: team.id,
        rosterPlayerId,
        kind,
        filename: this.safeFilename(file.originalname),
        mimeType,
        sizeBytes: file.size,
        data: new Uint8Array(file.buffer),
      },
      update: {
        filename: this.safeFilename(file.originalname),
        mimeType,
        sizeBytes: file.size,
        data: new Uint8Array(file.buffer),
        uploadedAt: new Date(),
      },
      select: DOCUMENT_META_SELECT,
    });
  }

  async listByEditToken(token: string) {
    const team = await this.prisma.eventTeam.findUnique({
      where: { editToken: token },
      select: { id: true },
    });

    if (!team) {
      throw new NotFoundException('Squad not found');
    }

    return this.prisma.eventDocument.findMany({
      where: { teamId: team.id },
      select: DOCUMENT_META_SELECT,
      orderBy: { uploadedAt: 'asc' },
    });
  }

  async deleteByEditToken(token: string, documentId: string) {
    const team = await this.prisma.eventTeam.findUnique({
      where: { editToken: token },
      select: { id: true, status: true },
    });

    if (!team) {
      throw new NotFoundException('Squad not found');
    }

    if (team.status === EventTeamStatus.APPROVED) {
      throw new ForbiddenException(
        'This squad has been approved and can no longer be edited',
      );
    }

    const deleted = await this.prisma.eventDocument.deleteMany({
      where: { id: documentId, teamId: team.id },
    });

    if (deleted.count === 0) {
      throw new NotFoundException('Document not found');
    }

    return { deleted: true };
  }

  async readForOrganizer(
    eventId: string,
    documentId: string,
    user: RequestingUser,
  ) {
    await this.eventsService.findOneForOrganizer(eventId, user);

    const document = await this.prisma.eventDocument.findFirst({
      where: { id: documentId, team: { eventId } },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return document;
  }

  async purgeForEvent(eventId: string) {
    const { count } = await this.prisma.eventDocument.deleteMany({
      where: { team: { eventId } },
    });
    return count;
  }

  private sniffMime(buffer: Buffer): SniffedMime {
    if (
      buffer.length > 4 &&
      buffer[0] === 0x25 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x44 &&
      buffer[3] === 0x46
    ) {
      return 'application/pdf';
    }
    if (
      buffer.length > 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return 'image/jpeg';
    }
    if (
      buffer.length > 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return 'image/png';
    }
    throw new BadRequestException('Upload a PDF, JPEG, or PNG file');
  }

  private safeFilename(original: string): string {
    return (original || 'document')
      .replace(/[\r\n"\\]/g, '')
      .split(/[/\\]/)
      .pop()!
      .slice(0, 150);
  }
}
