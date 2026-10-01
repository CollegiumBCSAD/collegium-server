import 'dotenv/config';
import {
  PrismaClient,
  GameTitle,
  Role,
  AccountStatus,
} from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
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
  tag: string;
}> = [
  { title: GameTitle.VALORANT, tag: 'VALO' },
  { title: GameTitle.LOL, tag: 'LOL' },
  { title: GameTitle.MLBB, tag: 'ML' },
  { title: GameTitle.CODM, tag: 'CODM' },
];

async function main() {
  console.log('--- Starting Addition/Upsert of 8 Athlete Accounts Per University ---');
  const hashedPassword = await bcrypt.hash(SEED_PASSWORD, 10);

  const existingUnis = await prisma.university.findMany();
  const uniByDomain = new Map(existingUnis.map((u) => [u.domain.toLowerCase(), u]));

  let totalUsersProcessed = 0;
  let totalHandlesCreated = 0;

  for (const uniConfig of UNIVERSITIES) {
    let university = uniByDomain.get(uniConfig.domain.toLowerCase());

    if (!university) {
      console.log(`University not found in DB for domain ${uniConfig.domain}, creating...`);
      university = await prisma.university.create({
        data: {
          name: uniConfig.name,
          domain: uniConfig.domain,
        },
      });
      uniByDomain.set(uniConfig.domain.toLowerCase(), university);
    }

    console.log(`\nProcessing ${uniConfig.name} (${uniConfig.short}) [${uniConfig.domain}]...`);

    // Ensure captain account exists and has handles
    const captainEmail = `captain@${uniConfig.domain}`;
    const captain = await prisma.user.upsert({
      where: { email: captainEmail },
      update: {
        role: Role.ATHLETE,
        status: AccountStatus.ACTIVE,
        emailVerified: true,
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

    for (const game of GAMES) {
      const handle = `${uniConfig.short}Cap.${game.tag}`;
      await prisma.userGameHandle.upsert({
        where: {
          userId_gameTitle: {
            userId: captain.id,
            gameTitle: game.title,
          },
        },
        update: { handle },
        create: {
          userId: captain.id,
          gameTitle: game.title,
          handle,
        },
      });
      totalHandlesCreated++;
    }

    // Ensure 8 player accounts: player1 to player8
    for (let i = 1; i <= 8; i++) {
      const email = `player${i}@${uniConfig.domain}`;
      const displayName = `${uniConfig.short} Player ${i}`;

      const user = await prisma.user.upsert({
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

      totalUsersProcessed++;

      // Upsert game handles for all 4 game titles
      for (const game of GAMES) {
        const handle = `${uniConfig.short}${game.tag}${i}`;
        await prisma.userGameHandle.upsert({
          where: {
            userId_gameTitle: {
              userId: user.id,
              gameTitle: game.title,
            },
          },
          update: { handle },
          create: {
            userId: user.id,
            gameTitle: game.title,
            handle,
          },
        });
        totalHandlesCreated++;
      }
    }
    console.log(`  ✓ Checked/Created 8 athlete accounts (player1–player8) + captain for ${uniConfig.short}`);
  }

  console.log('\n--- Complete ---');
  console.log(`Total athlete accounts processed: ${totalUsersProcessed}`);
  console.log(`Total game handles created/verified: ${totalHandlesCreated}`);
}

main()
  .catch((e) => {
    console.error('Error running add-athletes script:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
