import 'dotenv/config';
import { PrismaClient, GameTitle, MatchMode, Role, TournamentStatus } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { GlickoService } from '../src/universities/glicko.service';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const glicko = new GlickoService();

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

const ROSTER_ROLES = ['Duelist', 'Controller', 'Sentinel', 'Initiator', 'Flex'];

const BRACKET: Array<{ id: string; winner: string; loser: string; playedAt: string }> = [
  { id: 'QF1', winner: 'UMak', loser: 'Adamson', playedAt: '2026-07-20' },
  { id: 'QF2', winner: 'Ateneo', loser: 'Mapua', playedAt: '2026-07-20' },
  { id: 'QF3', winner: 'DLSU', loser: 'NU', playedAt: '2026-07-21' },
  { id: 'QF4', winner: 'UST', loser: 'FEU', playedAt: '2026-07-21' },
  { id: 'SF1', winner: 'UMak', loser: 'Ateneo', playedAt: '2026-07-27' },
  { id: 'SF2', winner: 'DLSU', loser: 'UST', playedAt: '2026-07-27' },
  { id: '3RD', winner: 'Ateneo', loser: 'UST', playedAt: '2026-08-03' },
  { id: 'FINAL', winner: 'UMak', loser: 'DLSU', playedAt: '2026-08-03' },
];

function inviteCode(): string {
  return randomBytes(4).toString('hex').toLowerCase();
}

async function wipe() {
  await prisma.valorantPlayerStat.deleteMany();
  await prisma.playerStat.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.scrim.deleteMany();
  await prisma.match.deleteMany();
  await prisma.universityGameRating.deleteMany();
  await prisma.team.deleteMany();
  await prisma.tournament.deleteMany();
  await prisma.user.deleteMany();
  await prisma.university.deleteMany();
}

async function main() {
  await wipe();

  const hashedPassword = await bcrypt.hash(SEED_PASSWORD, 10);

  const universityByShort = new Map<string, { id: string; short: string }>();
  const teamByShort = new Map<string, { id: string; captainId: string }>();

  for (const uni of UNIVERSITIES) {
    const university = await prisma.university.create({
      data: { name: uni.name, domain: uni.domain },
    });
    universityByShort.set(uni.short, { id: university.id, short: uni.short });

    const captain = await prisma.user.create({
      data: {
        email: `captain@${uni.domain}`,
        password: hashedPassword,
        displayName: `${uni.short} Team Captain`,
        role: Role.ATHLETE,
        universityId: university.id,
        status: 'ACTIVE',
      },
    });

    const athletes: Array<{ id: string }> = [];
    for (let i = 0; i < ROSTER_ROLES.length - 1; i++) {
      const athlete = await prisma.user.create({
        data: {
          email: `player${i + 1}@${uni.domain}`,
          password: hashedPassword,
          displayName: `${uni.short} Player ${i + 1}`,
          role: Role.ATHLETE,
          universityId: university.id,
          status: 'ACTIVE',
        },
      });
      athletes.push(athlete);
    }

    const team = await prisma.team.create({
      data: {
        name: `${uni.short} Valorant`,
        gameTitle: GameTitle.VALORANT,
        universityId: university.id,
        captainId: captain.id,
        inviteCode: inviteCode(),
        members: {
          create: [
            {
              userId: captain.id,
              gameHandle: `${uni.short}Captain#PH1`,
              preferredRole: ROSTER_ROLES[0],
              status: 'ACCEPTED',
            },
            ...athletes.map((athlete, i) => ({
              userId: athlete.id,
              gameHandle: `${uni.short}Player${i + 1}#PH1`,
              preferredRole: ROSTER_ROLES[i + 1],
              status: 'ACCEPTED' as const,
            })),
          ],
        },
      },
    });
    teamByShort.set(uni.short, { id: team.id, captainId: captain.id });
  }

  await prisma.user.create({
    data: {
      email: 'admin@umak.edu.ph',
      password: hashedPassword,
      displayName: 'Collegium Admin',
      role: Role.ADMIN,
      universityId: universityByShort.get('UMak')!.id,
      status: 'ACTIVE',
    },
  });

  await prisma.user.create({
    data: {
      email: 'organizer@umak.edu.ph',
      password: hashedPassword,
      displayName: 'UMak Tournament Host',
      role: Role.ORGANIZER,
      universityId: universityByShort.get('UMak')!.id,
      status: 'ACTIVE',
    },
  });

  const tournament = await prisma.tournament.create({
    data: {
      name: 'PH Collegiate Valorant Invitational — Season 1',
      status: TournamentStatus.COMPLETED,
      universities: {
        connect: UNIVERSITIES.map((uni) => ({ id: universityByShort.get(uni.short)!.id })),
      },
    },
  });

  const ratings = new Map<string, { rating: number; rd: number; sigma: number; wins: number; losses: number }>();

  for (const uni of UNIVERSITIES) {
    ratings.set(uni.short, { rating: 1500, rd: 350, sigma: 0.06, wins: 0, losses: 0 });
  }

  for (const [i, game] of BRACKET.entries()) {
    const winnerUni = universityByShort.get(game.winner)!;
    const loserUni = universityByShort.get(game.loser)!;

    await prisma.match.create({
      data: {
        riotMatchId: `SEED-VALO-${game.id}`,
        title: GameTitle.VALORANT,
        matchMode: MatchMode.TOURNAMENT,
        gameDuration: 1800 + i * 137,
        gameMode: 'Standard',
        platformId: 'PH',
        isVerified: true,
        playedAt: new Date(`${game.playedAt}T14:00:00Z`),
        winnerId: winnerUni.id,
        loserId: loserUni.id,
        tournamentId: tournament.id,
      },
    });

    const winnerState = ratings.get(game.winner)!;
    const loserState = ratings.get(game.loser)!;

    const result = glicko.calculateMatch(
      { rating: winnerState.rating, rd: winnerState.rd, sigma: winnerState.sigma },
      { rating: loserState.rating, rd: loserState.rd, sigma: loserState.sigma },
    );

    ratings.set(game.winner, { ...result.winner, wins: winnerState.wins + 1, losses: winnerState.losses });
    ratings.set(game.loser, { ...result.loser, wins: loserState.wins, losses: loserState.losses + 1 });
  }

  for (const uni of UNIVERSITIES) {
    const final = ratings.get(uni.short)!;
    await prisma.universityGameRating.create({
      data: {
        universityId: universityByShort.get(uni.short)!.id,
        gameTitle: GameTitle.VALORANT,
        glicko2_rating: final.rating,
        glicko2_rd: final.rd,
        glicko2_sigma: final.sigma,
        wins: final.wins,
        losses: final.losses,
      },
    });
  }

  console.log(`Seeded ${UNIVERSITIES.length} universities, ${UNIVERSITIES.length * 6 + 1} users, ${UNIVERSITIES.length} Valorant teams, 1 tournament with ${BRACKET.length} verified matches.`);
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
