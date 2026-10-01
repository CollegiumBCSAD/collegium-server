import 'dotenv/config';
import {
  PrismaClient,
  GameTitle,
  Role,
  AccountStatus,
  TeamMemberStatus,
} from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const SEED_PASSWORD = 'Collegium2026!';

const NEW_UNIVERSITIES = [
  { name: 'University of the Philippines', domain: 'up.edu.ph', short: 'UP' },
  { name: 'Polytechnic University of the Philippines', domain: 'pup.edu.ph', short: 'PUP' },
  { name: 'University of the East', domain: 'ue.edu.ph', short: 'UE' },
  { name: 'San Beda University', domain: 'sanbeda.edu.ph', short: 'San Beda' },
  { name: 'Colegio de San Juan de Letran', domain: 'letran.edu.ph', short: 'Letran' },
  { name: 'De La Salle-College of Saint Benilde', domain: 'benilde.edu.ph', short: 'Benilde' },
  { name: 'Arellano University', domain: 'arellano.edu.ph', short: 'Arellano' },
  { name: 'Technological University of the Philippines', domain: 'tup.edu.ph', short: 'TUP' },
];

const MLBB_ROLES = ['Gold', 'EXP', 'Mid', 'Jungle', 'Roam'];

function inviteCode(): string {
  return randomBytes(4).toString('hex').toLowerCase();
}

async function main() {
  console.log('--- Starting Creation of 8 New Universities & MLBB Squads ---');
  const hashedPassword = await bcrypt.hash(SEED_PASSWORD, 10);

  let totalUniversitiesCreated = 0;
  let totalUsersCreated = 0;
  let totalTeamsCreated = 0;
  let totalMembersCreated = 0;

  for (const uniConfig of NEW_UNIVERSITIES) {
    console.log(`\nProcessing ${uniConfig.name} (${uniConfig.short}) [${uniConfig.domain}]...`);

    // 1. Create or find University
    let university = await prisma.university.findUnique({
      where: { domain: uniConfig.domain },
    });

    if (!university) {
      university = await prisma.university.create({
        data: {
          name: uniConfig.name,
          domain: uniConfig.domain,
        },
      });
      totalUniversitiesCreated++;
      console.log(`  ✓ University created: ${uniConfig.name} (${university.id})`);
    } else {
      console.log(`  ✓ University already exists: ${uniConfig.name} (${university.id})`);
    }

    // 2. Create Captain (Athlete #1)
    const captainEmail = `captain@${uniConfig.domain}`;
    const captain = await prisma.user.upsert({
      where: { email: captainEmail },
      update: {
        role: Role.ATHLETE,
        status: AccountStatus.ACTIVE,
        emailVerified: true,
        universityId: university.id,
      },
      create: {
        email: captainEmail,
        password: hashedPassword,
        displayName: `${uniConfig.short} Team Captain`,
        role: Role.ATHLETE,
        universityId: university.id,
        status: AccountStatus.ACTIVE,
        emailVerified: true,
      },
    });
    totalUsersCreated++;

    // 3. Create 4 Players (Athletes #2–5)
    const players: Array<{ id: string; displayName: string }> = [];
    for (let i = 1; i <= 4; i++) {
      const email = `player${i}@${uniConfig.domain}`;
      const displayName = `${uniConfig.short} Player ${i}`;

      const player = await prisma.user.upsert({
        where: { email },
        update: {
          role: Role.ATHLETE,
          status: AccountStatus.ACTIVE,
          emailVerified: true,
          universityId: university.id,
        },
        create: {
          email,
          password: hashedPassword,
          displayName,
          role: Role.ATHLETE,
          universityId: university.id,
          status: AccountStatus.ACTIVE,
          emailVerified: true,
        },
      });
      players.push({ id: player.id, displayName });
      totalUsersCreated++;
    }

    const allMembers = [
      { id: captain.id, displayName: captain.displayName, isCaptain: true },
      ...players.map((p) => ({ id: p.id, displayName: p.displayName, isCaptain: false })),
    ];

    // 4. Create MLBB Team / Squad
    let mlbbTeam = await prisma.team.findFirst({
      where: {
        universityId: university.id,
        gameTitle: GameTitle.MLBB,
      },
    });

    const teamName = `${uniConfig.short} Mobile Legends`;

    if (!mlbbTeam) {
      mlbbTeam = await prisma.team.create({
        data: {
          name: teamName,
          gameTitle: GameTitle.MLBB,
          universityId: university.id,
          captainId: captain.id,
          inviteCode: inviteCode(),
          glicko2_rating: 1500,
          glicko2_rd: 350,
          glicko2_sigma: 0.06,
          rd_anchor: 350,
          min_roster_size: 5,
          max_roster_size: 6,
        },
      });
      totalTeamsCreated++;
      console.log(`  ✓ MLBB Team created: "${teamName}" (ID: ${mlbbTeam.id})`);
    } else {
      console.log(`  ✓ MLBB Team already exists: "${mlbbTeam.name}" (ID: ${mlbbTeam.id})`);
    }

    // 5. Populate/Verify 5 Roster Members and Game Handles
    for (let i = 0; i < allMembers.length; i++) {
      const member = allMembers[i];
      const preferredRole = MLBB_ROLES[i] ?? 'Flex';
      const gameHandle = member.isCaptain ? `${uniConfig.short}Cap.ML` : `${uniConfig.short}ML${i}`;

      // Upsert TeamMember
      const existingMembership = await prisma.teamMember.findFirst({
        where: {
          teamId: mlbbTeam.id,
          userId: member.id,
        },
      });

      if (!existingMembership) {
        await prisma.teamMember.create({
          data: {
            teamId: mlbbTeam.id,
            userId: member.id,
            gameHandle,
            preferredRole,
            status: TeamMemberStatus.ACCEPTED,
          },
        });
        totalMembersCreated++;
      }

      // Upsert UserGameHandle for MLBB
      await prisma.userGameHandle.upsert({
        where: {
          userId_gameTitle: {
            userId: member.id,
            gameTitle: GameTitle.MLBB,
          },
        },
        update: { handle: gameHandle },
        create: {
          userId: member.id,
          gameTitle: GameTitle.MLBB,
          handle: gameHandle,
        },
      });
    }

    console.log(`  ✓ 5 roster members (1 Captain + 4 Players) verified on "${teamName}"`);
  }

  console.log('\n--- Complete ---');
  console.log(`Total new universities processed: ${NEW_UNIVERSITIES.length}`);
  console.log(`Total teams created/verified: ${totalTeamsCreated}`);
  console.log(`Total users processed: ${totalUsersCreated}`);
  console.log(`Total roster memberships created/verified: ${totalMembersCreated}`);
}

main()
  .catch((e) => {
    console.error('Error seeding new MLBB universities:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
