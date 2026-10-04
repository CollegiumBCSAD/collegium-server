import 'dotenv/config';
import { PrismaClient, Role, AccountStatus } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

// Test data: one approved Coach/Manager per university (coach@<domain>),
// assigned to every team that university's seeded captain (captain@<domain>)
// runs. Teams captained by anyone else are left coachless so the captain
// registration fallback stays testable. Safe to re-run.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const SEED_PASSWORD = 'Collegium2026!';

async function main() {
  const hashedPassword = await bcrypt.hash(SEED_PASSWORD, 10);
  const universities = await prisma.university.findMany({
    orderBy: { name: 'asc' },
  });

  for (const university of universities) {
    const short = university.domain.split('.')[0].toUpperCase();

    const coach = await prisma.user.upsert({
      where: { email: `coach@${university.domain}` },
      update: {
        role: Role.COACH,
        status: AccountStatus.ACTIVE,
        emailVerified: true,
      },
      create: {
        email: `coach@${university.domain}`,
        password: hashedPassword,
        displayName: `${short} Head Coach`,
        role: Role.COACH,
        status: AccountStatus.ACTIVE,
        emailVerified: true,
        universityId: university.id,
      },
    });

    // A coach can't hold a player slot on a team they coach.
    await prisma.teamMember.deleteMany({ where: { userId: coach.id } });

    const assigned = await prisma.team.updateMany({
      where: {
        universityId: university.id,
        captain: { email: `captain@${university.domain}` },
        OR: [{ coachId: null }, { coachId: coach.id }],
      },
      data: { coachId: coach.id },
    });

    console.log(
      `${university.domain.padEnd(24)} coach@${university.domain} → ${assigned.count} team(s)`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
