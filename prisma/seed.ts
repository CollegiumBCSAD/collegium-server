import 'dotenv/config';
import {
  PrismaClient,
  GameTitle,
  MatchMode,
  Role,
  TournamentStatus,
  TournamentApplicationStatus,
  NotificationCategory,
  NotificationType,
  ScrimStatus,
  DataSource,
} from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { RankingService } from '../src/ranking/ranking.service';
import type { PrismaService } from '../src/prisma/prisma.service';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const SEED_PASSWORD = 'Collegium2026!';

const UNIVERSITIES = [
  { name: 'University of Makati', domain: 'umak.edu.ph', short: 'UMak' },
  { name: 'Ateneo de Manila University', domain: 'admu.edu.ph', short: 'Ateneo' },
  { name: 'De La Salle University', domain: 'dlsu.edu.ph', short: 'DLSU' },
  { name: 'University of Santo Tomas', domain: 'ust.edu.ph', short: 'UST' },
  { name: 'Far Eastern University', domain: 'feu.edu.ph', short: 'FEU' },
  { name: 'National University', domain: 'nu.edu.ph', short: 'NU' },
  { name: 'Mapúa University', domain: 'mapua.edu.ph', short: 'Mapua' },
  { name: 'Adamson University', domain: 'adamson.edu.ph', short: 'Adamson' },
];

const GAMES: Array<{
  title: GameTitle;
  label: string;
  tag: string;
  roles: string[];
  minRosterSize: number;
  maxRosterSize: number;
}> = [
  { title: GameTitle.VALORANT, label: 'Valorant', tag: 'VALO', roles: ['Duelist', 'Controller', 'Sentinel', 'Initiator', 'Flex'], minRosterSize: 5, maxRosterSize: 6 },
  { title: GameTitle.LOL, label: 'League of Legends', tag: 'LOL', roles: ['Top', 'Jungle', 'Mid', 'ADC', 'Support'], minRosterSize: 5, maxRosterSize: 7 },
  { title: GameTitle.MLBB, label: 'Mobile Legends', tag: 'ML', roles: ['Gold', 'EXP', 'Mid', 'Jungle', 'Roam'], minRosterSize: 5, maxRosterSize: 6 },
  { title: GameTitle.CODM, label: 'Call of Duty Mobile', tag: 'CODM', roles: ['Slayer', 'Objective', 'Anchor', 'Flex', 'Support'], minRosterSize: 5, maxRosterSize: 6 },
];

// Deterministic per-player stat line so a reseed always reproduces the same box
// score. Winners trend higher, but the spread across roster slots is what makes
// the MVP crown land on different players from match to match.
function seededStatLine(matchIndex: number, slot: number, won: boolean) {
  const swing = (matchIndex * 3 + slot * 5) % 7;
  return {
    kills: Math.max(2, (won ? 17 : 11) + swing - 3),
    deaths: Math.max(1, (won ? 11 : 16) + ((matchIndex + slot * 2) % 5) - 2),
    assists: Math.max(0, 3 + ((matchIndex * 2 + slot) % 8)),
  };
}

const COMPLETED_BRACKET: Array<{ id: string; round: number; winner: string; loser: string; playedAt: string }> = [
  { id: 'QF1', round: 1, winner: 'UMak', loser: 'Adamson', playedAt: '2026-07-20' },
  { id: 'QF2', round: 1, winner: 'Ateneo', loser: 'Mapua', playedAt: '2026-07-20' },
  { id: 'QF3', round: 1, winner: 'DLSU', loser: 'NU', playedAt: '2026-07-21' },
  { id: 'QF4', round: 1, winner: 'UST', loser: 'FEU', playedAt: '2026-07-21' },
  { id: 'SF1', round: 2, winner: 'UMak', loser: 'Ateneo', playedAt: '2026-07-27' },
  { id: 'SF2', round: 2, winner: 'DLSU', loser: 'UST', playedAt: '2026-07-27' },
  { id: 'FINAL', round: 3, winner: 'UMak', loser: 'DLSU', playedAt: '2026-08-03' },
];

function inviteCode(): string {
  return randomBytes(4).toString('hex').toLowerCase();
}

async function wipe() {
  await prisma.notification.deleteMany();
  await prisma.scrimChatMessage.deleteMany();
  await prisma.valorantPlayerStat.deleteMany();
  await prisma.playerStat.deleteMany();
  await prisma.userGameHandle.deleteMany();
  await prisma.tournamentApplication.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.ratingHistory.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.scrim.deleteMany();
  await prisma.match.deleteMany();
  await prisma.team.deleteMany();
  await prisma.tournament.deleteMany();
  await prisma.user.deleteMany();
  await prisma.university.deleteMany();
}

async function main() {
  await wipe();

  const hashedPassword = await bcrypt.hash(SEED_PASSWORD, 10);

  const universityByShort = new Map<string, string>();
  const captainByShort = new Map<string, string>();
  const teamByShortGame = new Map<string, string>();

  for (const uni of UNIVERSITIES) {
    const university = await prisma.university.create({
      data: { name: uni.name, domain: uni.domain },
    });
    universityByShort.set(uni.short, university.id);

    const captain = await prisma.user.create({
      data: {
        email: `captain@${uni.domain}`,
        password: hashedPassword,
        displayName: `${uni.short} Team Captain`,
        role: Role.ATHLETE,
        universityId: university.id,
        status: 'ACTIVE',
        emailVerified: true,
      },
    });
    captainByShort.set(uni.short, captain.id);

    const players: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const athlete = await prisma.user.create({
        data: {
          email: `player${i}@${uni.domain}`,
          password: hashedPassword,
          displayName: `${uni.short} Player ${i}`,
          role: Role.ATHLETE,
          universityId: university.id,
          status: 'ACTIVE',
          emailVerified: true,
        },
      });
      players.push(athlete.id);
    }

    const rosterIds = [captain.id, ...players];

    for (const game of GAMES) {
      const team = await prisma.team.create({
        data: {
          name: `${uni.short} ${game.label}`,
          gameTitle: game.title,
          universityId: university.id,
          captainId: captain.id,
          inviteCode: inviteCode(),
          glicko2_rating: 1500,
          glicko2_rd: 350,
          glicko2_sigma: 0.06,
          rd_anchor: 350,
          last_rated_at: null,
          min_roster_size: game.minRosterSize,
          max_roster_size: game.maxRosterSize,
          members: {
            create: rosterIds.map((userId, i) => ({
              userId,
              gameHandle: i === 0 ? `${uni.short}Cap.${game.tag}` : `${uni.short}${game.tag}${i}`,
              preferredRole: game.roles[i],
              status: 'ACCEPTED' as const,
            })),
          },
        },
      });
      teamByShortGame.set(`${uni.short}:${game.title}`, team.id);

      for (let i = 0; i < rosterIds.length; i++) {
        const userId = rosterIds[i];
        const handle = i === 0 ? `${uni.short}Cap.${game.tag}` : `${uni.short}${game.tag}${i}`;
        await prisma.userGameHandle.upsert({
          where: {
            userId_gameTitle: {
              userId,
              gameTitle: game.title,
            },
          },
          update: { handle },
          create: { userId, gameTitle: game.title, handle },
        });
      }
    }
  }

  await prisma.user.create({
    data: {
      email: 'admin@umak.edu.ph',
      password: hashedPassword,
      displayName: 'Collegium Admin',
      role: Role.ADMIN,
      universityId: universityByShort.get('UMak')!,
      status: 'ACTIVE',
      emailVerified: true,
    },
  });

  const organizer = await prisma.user.create({
    data: {
      email: 'organizer@umak.edu.ph',
      password: hashedPassword,
      displayName: 'UMak Tournament Host',
      role: Role.ORGANIZER,
      universityId: universityByShort.get('UMak')!,
      status: 'ACTIVE',
      emailVerified: true,
    },
  });

  const completed = await prisma.tournament.create({
    data: {
      name: 'PH Collegiate Valorant Invitational — Season 1',
      gameTitle: GameTitle.VALORANT,
      bracketFormat: 'Single Elimination',
      teamQuota: 8,
      status: TournamentStatus.COMPLETED,
      universities: {
        connect: UNIVERSITIES.map((uni) => ({ id: universityByShort.get(uni.short)! })),
      },
    },
  });

  for (const [i, game] of COMPLETED_BRACKET.entries()) {
    const match = await prisma.match.create({
      data: {
        riotMatchId: `SEED-VALO-${game.id}`,
        title: GameTitle.VALORANT,
        matchMode: MatchMode.TOURNAMENT,
        gameDuration: 1800 + i * 137,
        gameMode: 'Standard',
        platformId: 'PH',
        isVerified: true,
        round: game.round,
        playedAt: new Date(`${game.playedAt}T14:00:00Z`),
        winnerId: universityByShort.get(game.winner)!,
        loserId: universityByShort.get(game.loser)!,
        tournamentId: completed.id,
      },
    });

    // Without these, a finished bracket has a winner but an empty box score —
    // the match history and KDA tables would have nothing to render.
    for (const [short, won] of [
      [game.winner, true],
      [game.loser, false],
    ] as const) {
      const roster = await prisma.teamMember.findMany({
        where: {
          teamId: teamByShortGame.get(`${short}:${GameTitle.VALORANT}`)!,
          status: 'ACCEPTED',
        },
        orderBy: { joinedAt: 'asc' },
      });

      await prisma.playerStat.createMany({
        data: roster.map((member, slot) => ({
          matchId: match.id,
          universityId: universityByShort.get(short)!,
          userId: member.userId,
          summonerName: member.gameHandle,
          ...seededStatLine(i, slot, won),
          win: won,
          dataSource: DataSource.PEER_VERIFIED,
        })),
      });
    }
  }

  // Run the real Glicko-2 batch closure (same pipeline the app calls at tournament
  // close) against the completed invitational, so the leaderboard and each team's
  // RatingHistory show authentic post-tournament numbers instead of the untouched
  // 1500/350/0.06 default. PrismaService is a thin PrismaClient subclass (see
  // src/prisma/prisma.service.ts) — safe to hand this raw client to it directly.
  const ranking = new RankingService(prisma as unknown as PrismaService);
  const closure = await ranking.closeTournamentRatingPeriod(completed.id);

  // Applications that are PENDING or REJECTED (rather than APPROVED) so the
  // organizer has something to demo in the review queue live. Left out of the
  // round-1 pairing below since they haven't been approved into the bracket yet.
  const VALORANT_PENDING = ['NU'];
  const VALORANT_REJECTED = ['Mapua'];

  let ongoingTournaments = 0;
  let ongoingMatches = 0;

  for (const game of GAMES) {
    const isValorant = game.title === GameTitle.VALORANT;
    const pendingShorts = isValorant ? VALORANT_PENDING : [];
    const rejectedShorts = isValorant ? VALORANT_REJECTED : [];
    const approvedUnis = UNIVERSITIES.filter(
      (u) => !pendingShorts.includes(u.short) && !rejectedShorts.includes(u.short),
    );

    const tournament = await prisma.tournament.create({
      data: {
        name: `${game.label} Collegiate Series — Live`,
        gameTitle: game.title,
        bracketFormat: 'Single Elimination',
        teamQuota: 8,
        rules: 'Best of 3 up to the final, Best of 5 grand final. Registered varsity rosters only.',
        status: TournamentStatus.ONGOING,
        organizerId: organizer.id,
        universities: {
          connect: approvedUnis.map((uni) => ({ id: universityByShort.get(uni.short)! })),
        },
      },
    });
    ongoingTournaments++;

    for (const uni of UNIVERSITIES) {
      const status = pendingShorts.includes(uni.short)
        ? TournamentApplicationStatus.PENDING
        : rejectedShorts.includes(uni.short)
          ? TournamentApplicationStatus.REJECTED
          : TournamentApplicationStatus.APPROVED;

      await prisma.tournamentApplication.create({
        data: {
          tournamentId: tournament.id,
          universityId: universityByShort.get(uni.short)!,
          userId: captainByShort.get(uni.short)!,
          applicantName: `${uni.short} Team Captain`,
          teamId: teamByShortGame.get(`${uni.short}:${game.title}`)!,
          teamName: `${uni.short} ${game.label}`,
          status,
        },
      });
    }

    for (let i = 0; i < approvedUnis.length; i += 2) {
      await prisma.match.create({
        data: {
          title: game.title,
          matchMode: MatchMode.TOURNAMENT,
          tournamentId: tournament.id,
          gameDuration: 0,
          gameMode: 'CLASSIC',
          platformId: 'PH',
          isVerified: false,
          round: 1,
          winnerId: universityByShort.get(approvedUnis[i].short)!,
          loserId: universityByShort.get(approvedUnis[i + 1].short)!,
        },
      });
      ongoingMatches++;
    }
  }

  // Second organizer with a tournament still awaiting Admin approval — demos the
  // PENDING_APPROVAL -> UPCOMING admin review flow (GET/POST /admin/tournaments).
  const organizer2 = await prisma.user.create({
    data: {
      email: 'organizer2@umak.edu.ph',
      password: hashedPassword,
      displayName: 'Manila Esports League Host',
      role: Role.ORGANIZER,
      universityId: universityByShort.get('UMak')!,
      status: 'ACTIVE',
      emailVerified: true,
    },
  });

  await prisma.tournament.create({
    data: {
      name: 'Manila Community Clash — Mobile Legends',
      gameTitle: GameTitle.MLBB,
      bracketFormat: 'Single Elimination',
      teamQuota: 8,
      rules: 'Open community bracket, best of 3 up to the final.',
      status: TournamentStatus.PENDING_APPROVAL,
      organizerId: organizer2.id,
    },
  });

  // A pending roster join request on UMak's Valorant squad — demos the team
  // captain's accept/decline flow independently of the tournament application flow.
  const walkIn = await prisma.user.create({
    data: {
      email: 'walkin@umak.edu.ph',
      password: hashedPassword,
      displayName: 'UMak Walk-in Athlete',
      role: Role.ATHLETE,
      universityId: universityByShort.get('UMak')!,
      status: 'ACTIVE',
      emailVerified: true,
    },
  });

  const umakValoTeamId = teamByShortGame.get(`UMak:${GameTitle.VALORANT}`)!;
  await prisma.teamMember.create({
    data: {
      teamId: umakValoTeamId,
      userId: walkIn.id,
      gameHandle: 'UMakWalkIn.VALO',
      preferredRole: 'Flex',
      status: 'PENDING',
    },
  });

  // Scrims: one open request, one confirmed scrim with war room chat, one
  // completed scrim, to cover the practice-match flow end to end.
  const ateneoLolTeamId = teamByShortGame.get(`Ateneo:${GameTitle.LOL}`)!;
  const dlsuLolTeamId = teamByShortGame.get(`DLSU:${GameTitle.LOL}`)!;
  const ustCodmTeamId = teamByShortGame.get(`UST:${GameTitle.CODM}`)!;
  const feuCodmTeamId = teamByShortGame.get(`FEU:${GameTitle.CODM}`)!;

  await prisma.scrim.create({
    data: {
      teamId: umakValoTeamId,
      gameTitle: GameTitle.VALORANT,
      scheduledAt: new Date('2026-09-20T13:00:00Z'),
      format: 'Best of 1',
      rankRange: 'Any',
      mapPreference: "Organizer's choice",
      notes: 'Looking for a scrim ahead of the Live series.',
      status: ScrimStatus.OPEN,
    },
  });

  const confirmedScrim = await prisma.scrim.create({
    data: {
      teamId: ateneoLolTeamId,
      opponentId: dlsuLolTeamId,
      gameTitle: GameTitle.LOL,
      scheduledAt: new Date('2026-09-18T11:00:00Z'),
      format: 'Best of 3',
      status: ScrimStatus.CONFIRMED,
    },
  });

  await prisma.scrimChatMessage.createMany({
    data: [
      {
        scrimId: confirmedScrim.id,
        senderId: captainByShort.get('Ateneo')!,
        senderName: 'Ateneo Team Captain',
        teamName: 'Ateneo League of Legends',
        text: "Confirmed for Friday 7PM, see you on Summoner's Rift.",
      },
      {
        scrimId: confirmedScrim.id,
        senderId: captainByShort.get('DLSU')!,
        senderName: 'DLSU Team Captain',
        teamName: 'DLSU League of Legends',
        text: "Bet, we'll be there.",
      },
    ],
  });

  await prisma.scrim.create({
    data: {
      teamId: ustCodmTeamId,
      opponentId: feuCodmTeamId,
      gameTitle: GameTitle.CODM,
      scheduledAt: new Date('2026-09-05T09:00:00Z'),
      format: 'Best of 1',
      status: ScrimStatus.COMPLETED,
    },
  });

  // Notifications so the bell/badge already has content without needing a live
  // trigger during the demo.
  await prisma.notification.createMany({
    data: [
      {
        userId: captainByShort.get('UMak')!,
        category: NotificationCategory.TEAM,
        type: NotificationType.TEAM_JOIN_REQUEST,
        title: 'New roster join request',
        message: 'UMak Walk-in Athlete requested to join UMak Valorant.',
        link: '/dashboard',
        refId: `${umakValoTeamId}:${walkIn.id}`,
        read: false,
      },
      {
        userId: captainByShort.get('Ateneo')!,
        category: NotificationCategory.SCRIM,
        type: NotificationType.SCRIM_REQUEST_ACCEPTED,
        title: 'Scrim confirmed',
        message: 'DLSU League of Legends accepted your scrim request for Sep 18.',
        link: '/scrims',
        refId: confirmedScrim.id,
        read: false,
      },
      {
        userId: captainByShort.get('DLSU')!,
        category: NotificationCategory.TOURNAMENT,
        type: NotificationType.TOURNAMENT_APPROVED,
        title: 'Application approved',
        message: "Your squad's application to League of Legends Collegiate Series — Live was approved.",
        link: '/tournaments',
        read: true,
      },
    ],
  });

  const teamCount = UNIVERSITIES.length * GAMES.length;
  console.log(
    `Seeded ${UNIVERSITIES.length} universities, ${UNIVERSITIES.length * 5 + 4} users, ${teamCount} teams across ${GAMES.length} games.`,
  );
  console.log(
    `Completed invitational: rating period closed, ${closure.teamsUpdated.length} teams rated at event weight ${closure.eventWeight}x (see RatingHistory).`,
  );
  console.log(
    `Ongoing: ${ongoingTournaments} organizer-owned ONGOING tournaments (${ongoingMatches} round-1 matches ready to report), ` +
      `1 PENDING_APPROVAL tournament awaiting Admin review, Valorant has 1 PENDING + 1 REJECTED application queued for Organizer review.`,
  );
  console.log(
    'Also seeded: 1 pending team join request, 3 scrims (OPEN/CONFIRMED with chat/COMPLETED), 3 notifications.',
  );
  console.log(`All seeded accounts use password: ${SEED_PASSWORD}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
