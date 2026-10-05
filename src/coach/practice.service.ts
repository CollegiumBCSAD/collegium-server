import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationCategory,
  NotificationType,
  PracticeResult,
  Role,
  TeamAuditAction,
  TeamMemberStatus,
  User,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OcrService } from '../ocr/ocr.service';
import { FuzzyMatcherService } from '../ocr/fuzzy-matcher.service';
import { TeamAuthorityService } from './team-authority.service';
import {
  CreatePracticeRecordDto,
  CreatePracticeScheduleDto,
  UpdatePracticeScheduleDto,
} from './dto/coach.dto';

// An OCR read is accepted as-is only when the result was found on the
// scoreboard and enough of the roster was recognised with high confidence.
const CONFIDENCE_THRESHOLD = 0.85;
const MIN_ROSTER_MATCH_RATE = 0.6;

const WIN_WORDS = ['win', 'won', 'victory', 'victorious'];
const LOSS_WORDS = ['loss', 'lose', 'lost', 'defeat', 'defeated'];

@Injectable()
export class PracticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly ocrService: OcrService,
    private readonly fuzzyMatcher: FuzzyMatcherService,
    private readonly authority: TeamAuthorityService,
  ) {}

  // Coach, rostered athletes, and admins can view a team's practice data;
  // organizers and outsiders cannot.
  async assertCanView(teamId: string, user: User) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { coachId: true, captainId: true },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    if (
      user.role === Role.ADMIN ||
      team.coachId === user.id ||
      team.captainId === user.id
    ) {
      return;
    }

    const member = await this.prisma.teamMember.findFirst({
      where: { teamId, userId: user.id, status: TeamMemberStatus.ACCEPTED },
    });

    if (!member) {
      throw new ForbiddenException(
        "Only this team's coach and roster can view its practice data.",
      );
    }
  }

  // ── Schedules ─────────────────────────────────────────────────────────

  listSchedules(teamId: string) {
    return this.prisma.practiceSchedule.findMany({
      where: { teamId },
      include: { _count: { select: { records: true } } },
      orderBy: { startsAt: 'asc' },
    });
  }

  async createSchedule(
    teamId: string,
    coach: User,
    dto: CreatePracticeScheduleDto,
  ) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    this.assertWindow(startsAt, endsAt);

    const schedule = await this.prisma.practiceSchedule.create({
      data: {
        teamId,
        title: dto.title.trim(),
        startsAt,
        endsAt,
        location: dto.location?.trim() || null,
        notes: dto.notes?.trim() || null,
        createdById: coach.id,
      },
      include: { team: { select: { name: true } } },
    });

    const roster = await this.prisma.teamMember.findMany({
      where: { teamId, status: TeamMemberStatus.ACCEPTED },
      select: { userId: true },
    });

    const when = startsAt.toLocaleString('en-PH', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Manila',
    });

    await Promise.all(
      roster.map((m) =>
        this.notificationsService.create({
          userId: m.userId,
          category: NotificationCategory.TEAM,
          type: NotificationType.PRACTICE_SCHEDULED,
          title: '🗓️ Practice Scheduled',
          message: `${coach.displayName} scheduled "${schedule.title}" for ${schedule.team.name} on ${when}.`,
          link: '/dashboard',
          refId: schedule.id,
        }),
      ),
    );

    await this.authority.record(
      coach.id,
      teamId,
      TeamAuditAction.PRACTICE_SCHEDULED,
      { scheduleId: schedule.id, title: schedule.title },
    );

    return schedule;
  }

  async updateSchedule(
    teamId: string,
    scheduleId: string,
    coach: User,
    dto: UpdatePracticeScheduleDto,
  ) {
    const existing = await this.findSchedule(teamId, scheduleId);

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : existing.startsAt;
    const endsAt =
      dto.endsAt !== undefined ? new Date(dto.endsAt) : existing.endsAt;
    this.assertWindow(startsAt, endsAt);

    const schedule = await this.prisma.practiceSchedule.update({
      where: { id: scheduleId },
      data: {
        title: dto.title?.trim(),
        startsAt,
        endsAt,
        location: dto.location !== undefined ? dto.location.trim() : undefined,
        notes: dto.notes !== undefined ? dto.notes.trim() : undefined,
      },
    });

    await this.authority.record(
      coach.id,
      teamId,
      TeamAuditAction.PRACTICE_UPDATED,
      { scheduleId },
    );

    return schedule;
  }

  async deleteSchedule(teamId: string, scheduleId: string, coach: User) {
    const existing = await this.findSchedule(teamId, scheduleId);

    await this.prisma.practiceSchedule.delete({ where: { id: scheduleId } });

    await this.authority.record(
      coach.id,
      teamId,
      TeamAuditAction.PRACTICE_CANCELLED,
      { scheduleId, title: existing.title },
    );

    return { success: true };
  }

  private async findSchedule(teamId: string, scheduleId: string) {
    const schedule = await this.prisma.practiceSchedule.findUnique({
      where: { id: scheduleId },
    });

    if (!schedule || schedule.teamId !== teamId) {
      throw new NotFoundException('Practice schedule not found.');
    }

    return schedule;
  }

  private assertWindow(startsAt: Date, endsAt: Date | null) {
    if (endsAt && endsAt <= startsAt) {
      throw new BadRequestException('A practice must end after it starts.');
    }
  }

  // ── Practice records ──────────────────────────────────────────────────

  async listRecords(teamId: string) {
    const records = await this.prisma.practiceRecord.findMany({
      where: { teamId },
      include: {
        schedule: { select: { id: true, title: true, startsAt: true } },
        loggedBy: { select: { id: true, displayName: true } },
      },
      orderBy: { playedAt: 'desc' },
    });

    const wins = records.filter((r) => r.result === PracticeResult.WIN).length;

    return {
      summary: { wins, losses: records.length - wins, total: records.length },
      records,
    };
  }

  // Reads a scrim scoreboard for the outcome only. Per-player numbers are
  // used solely to judge how trustworthy the read is; nothing here touches
  // ratings or player stats.
  async scanRecord(teamId: string, image?: Express.Multer.File) {
    if (!image) {
      throw new BadRequestException('A scoreboard screenshot is required.');
    }

    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          where: { status: TeamMemberStatus.ACCEPTED },
          include: { user: { select: { displayName: true } } },
        },
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found.');
    }

    const scan = await this.ocrService.recognize(
      image.buffer,
      image.mimetype,
      image.originalname,
      team.gameTitle,
    );

    const candidates = team.members.map((m) => ({
      userId: m.userId,
      displayName: m.user.displayName,
      gameHandle: m.gameHandle,
      teamId: team.id,
      teamName: team.name,
      role: m.preferredRole,
    }));

    const resolved = this.fuzzyMatcher.resolveBatch(scan.players, candidates);
    const matched = resolved.filter((r) => r.resolution.isHighConfidence);

    const ourSide = matched
      .map((r) => scan.players.find((p) => p.ign === r.resolution.rawIgn))
      .filter((p) => p !== undefined);
    const detectedResult = this.detectResult(
      ourSide.length ? ourSide : scan.players,
    );

    const rosterTarget = Math.min(team.members.length, 5) || 1;
    const rosterMatchRate = Math.min(matched.length / rosterTarget, 1);
    const nameConfidence = matched.length
      ? matched.reduce((n, r) => n + r.resolution.confidence, 0) /
        matched.length
      : 0;
    const confidence = detectedResult
      ? Number((nameConfidence * rosterMatchRate).toFixed(2))
      : 0;

    return {
      teamId: team.id,
      detectedResult,
      completed: scan.players.length > 0,
      confidence,
      isConfident:
        detectedResult !== null &&
        nameConfidence >= CONFIDENCE_THRESHOLD &&
        rosterMatchRate >= MIN_ROSTER_MATCH_RATE,
      playersRead: scan.players.length,
      rosterMatched: matched.length,
      matchedPlayers: matched.map((r) => ({
        rawIgn: r.resolution.rawIgn,
        userId: r.resolution.matchedCandidate?.userId ?? null,
        gameHandle: r.resolution.matchedCandidate?.gameHandle ?? null,
        confidence: r.resolution.confidence,
      })),
    };
  }

  async createRecord(
    teamId: string,
    coach: User,
    dto: CreatePracticeRecordDto,
  ) {
    if (dto.scheduleId) {
      await this.findSchedule(teamId, dto.scheduleId);
    }

    const record = await this.prisma.practiceRecord.create({
      data: {
        teamId,
        scheduleId: dto.scheduleId ?? null,
        opponentName: dto.opponentName?.trim() || null,
        result: dto.result,
        completed: dto.completed,
        source: dto.source,
        ocrConfidence: dto.ocrConfidence ?? null,
        notes: dto.notes?.trim() || null,
        playedAt: dto.playedAt ? new Date(dto.playedAt) : undefined,
        loggedById: coach.id,
      },
    });

    await this.authority.record(
      coach.id,
      teamId,
      TeamAuditAction.PRACTICE_RECORD_LOGGED,
      { recordId: record.id, result: record.result, source: record.source },
    );

    return record;
  }

  // The OCR service doesn't report a winner as a first-class field; some
  // title templates put it in a row's `extra` bag. Anything ambiguous comes
  // back null so the coach picks the result by hand.
  private detectResult(
    players: Array<{ extra: Record<string, unknown> }>,
  ): PracticeResult | null {
    const votes = players
      .map((p) => {
        const { win, result, outcome } = p.extra ?? {};
        if (typeof win === 'boolean') return win;
        const text = [result, outcome].find((v) => typeof v === 'string');
        if (!text) return null;
        const word = text.toLowerCase().trim();
        if (WIN_WORDS.includes(word)) return true;
        if (LOSS_WORDS.includes(word)) return false;
        return null;
      })
      .filter((v): v is boolean => v !== null);

    if (!votes.length) return null;
    if (votes.every((v) => v)) return PracticeResult.WIN;
    if (votes.every((v) => !v)) return PracticeResult.LOSS;
    return null;
  }
}
