import 'dotenv/config';
import {
  PrismaClient,
  GameTitle,
  MatchMode,
  Role,
  TournamentStatus,
  TournamentApplicationStatus,
} from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
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
    await prisma.match.create({
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
  }

  let ongoingTournaments = 0;
  let ongoingMatches = 0;

  for (const game of GAMES) {
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
          connect: UNIVERSITIES.map((uni) => ({ id: universityByShort.get(uni.short)! })),
        },
      },
    });
    ongoingTournaments++;

    for (const uni of UNIVERSITIES) {
      await prisma.tournamentApplication.create({
        data: {
          tournamentId: tournament.id,
          universityId: universityByShort.get(uni.short)!,
          userId: captainByShort.get(uni.short)!,
          applicantName: `${uni.short} Team Captain`,
          teamId: teamByShortGame.get(`${uni.short}:${game.title}`)!,
          teamName: `${uni.short} ${game.label}`,
          status: TournamentApplicationStatus.APPROVED,
        },
      });
    }

    for (let i = 0; i < UNIVERSITIES.length; i += 2) {
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
          winnerId: universityByShort.get(UNIVERSITIES[i].short)!,
          loserId: universityByShort.get(UNIVERSITIES[i + 1].short)!,
        },
      });
      ongoingMatches++;
    }
  }

  const teamCount = UNIVERSITIES.length * GAMES.length;
  console.log(
    `Seeded ${UNIVERSITIES.length} universities, ${UNIVERSITIES.length * 5 + 2} users, ${teamCount} teams across ${GAMES.length} games.`,
  );
  console.log(
    `Tournaments: 1 completed Valorant invitational + ${ongoingTournaments} organizer-owned ONGOING tournaments (${ongoingMatches} round-1 matches ready to report).`,
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
