/**
 * Seeds the 8 games and pricing from the RFP response (sections 2.1 and 3.1)
 * plus the admin account. Safe to run repeatedly (upserts).
 */
import { PlanType, PrismaClient, Role } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import { hashPassword } from '../src/common/password';

interface Catalog {
  categories: { id: string; label: string; color: string }[];
  games: {
    slug: string;
    name: string;
    category: string;
    path: string;
    image: string;
    description: string;
  }[];
}

const prisma = new PrismaClient();

const GAMES = [
  {
    slug: 'halloween-bubble-shooter',
    title: 'Halloween Bubble Shooter',
    category: 'Puzzle / Casual',
    description:
      'A Halloween-themed bubble shooting game where players match and pop colorful bubbles to complete challenging levels.',
    targetAudience: 'All Ages',
    gameUrl: 'https://muen-web.tmofamily.com/demo-game/14/index.html',
    themeColor: '#ea580c',
  },
  {
    slug: 'traffic-racer',
    title: 'Traffic Racer',
    category: 'Racing',
    description:
      'A high-speed endless racing game where players drive through traffic, earn rewards, and unlock new vehicles.',
    targetAudience: 'All Ages',
    gameUrl: 'https://muen-web.tmofamily.com/demo-game/24/index.html',
    themeColor: '#dc2626',
  },
  {
    slug: 'kids-coloring',
    title: 'Kids Coloring',
    category: 'Educational',
    description:
      "An interactive coloring game designed to encourage creativity and improve children's artistic skills through fun illustrations.",
    targetAudience: 'Children (3+)',
    gameUrl: 'https://muen-web.tmofamily.com/demo-game/34/index.html',
    themeColor: '#db2777',
  },
  {
    slug: 'air-combat',
    title: 'Air Combat',
    category: 'Action',
    description:
      'An aerial combat game where players pilot fighter aircraft, complete combat missions, and defeat enemy forces.',
    targetAudience: 'All Ages',
    gameUrl: 'https://muen-web.tmofamily.com/demo-game/35/index.html',
    themeColor: '#0369a1',
  },
  {
    slug: 'stickman',
    title: 'Stickman',
    category: 'Action / Adventure',
    description:
      'A fast-paced action game featuring Stickman characters in challenging missions, obstacle courses, and battles.',
    targetAudience: 'All Ages',
    gameUrl: 'https://muen-web.tmofamily.com/demo-game/37/index.html',
    themeColor: '#475569',
  },
  {
    slug: 'professor-bubble',
    title: 'Professor Bubble',
    category: 'Puzzle',
    description:
      'A classic bubble shooter game with increasingly difficult levels, strategic gameplay, and engaging visual effects.',
    targetAudience: 'All Ages',
    gameUrl: 'https://muen-web.tmofamily.com/demo-game/38/index.html',
    themeColor: '#7c3aed',
  },
  {
    slug: 'candy-match-3',
    title: 'Candy Match 3',
    category: 'Puzzle',
    description:
      'A colorful match-three puzzle game where players solve hundreds of levels by matching candies and earning rewards.',
    targetAudience: 'All Ages',
    gameUrl: 'https://muen-web.tmofamily.com/demo-game/40/index.html',
    themeColor: '#c026d3',
  },
  {
    slug: 'fast-dice',
    title: 'Fast Dice',
    category: 'Board / Casual',
    description:
      'A digital dice game offering quick multiplayer and single-player gameplay with exciting challenges and competitive scoring.',
    targetAudience: 'All Ages',
    gameUrl: 'https://muen-web.tmofamily.com/demo-game/43/index.html',
    themeColor: '#059669',
  },
];

// Section 3.1: daily 3 ETB, weekly 10 ETB, monthly 45 ETB, or pay-per-use.
// The proposal does not fix a pay-per-use price; 1 ETB per play is a placeholder
// to be agreed with Ethio Telecom (editable from the admin dashboard).
const PLANS: {
  type: PlanType;
  priceCents: number;
  durationHours: number | null;
  plays: number | null;
}[] = [
  { type: PlanType.DAILY, priceCents: 300, durationHours: 24, plays: null },
  {
    type: PlanType.WEEKLY,
    priceCents: 1000,
    durationHours: 24 * 7,
    plays: null,
  },
  {
    type: PlanType.MONTHLY,
    priceCents: 4500,
    durationHours: 24 * 30,
    plays: null,
  },
  {
    type: PlanType.PAY_PER_USE,
    priceCents: 100,
    durationHours: null,
    plays: 1,
  },
];

async function main() {
  for (const [i, g] of GAMES.entries()) {
    const game = await prisma.game.upsert({
      where: { slug: g.slug },
      update: { ...g, sortOrder: i },
      create: { ...g, sortOrder: i },
    });
    for (const p of PLANS) {
      await prisma.plan.upsert({
        where: { gameId_type: { gameId: game.id, type: p.type } },
        update: {},
        create: { gameId: game.id, ...p },
      });
    }
  }

  // The 140 games of the Ethio Telecom Games Portal. Paths are relative and resolved against
  // GAMES_BASE_URL at runtime, so moving the game server only needs a .env change.
  const catalog = JSON.parse(
    readFileSync(join(__dirname, 'games-catalog.json'), 'utf8'),
  ) as Catalog;
  const categories = new Map(catalog.categories.map((c) => [c.id, c]));
  for (const [i, g] of catalog.games.entries()) {
    const category = categories.get(g.category);
    if (!category)
      throw new Error(`Unknown category ${g.category} for ${g.slug}`);
    const game = await prisma.game.upsert({
      where: { slug: g.slug },
      // re-seeding only refreshes the links; titles, prices and settings edited in admin stay
      update: { gameUrl: g.path, imageUrl: g.image },
      create: {
        slug: g.slug,
        title: g.name,
        category: category.label,
        description: g.description,
        targetAudience: 'All Ages',
        gameUrl: g.path,
        imageUrl: g.image,
        themeColor: category.color,
        sortOrder: GAMES.length + i,
      },
    });
    for (const p of PLANS) {
      await prisma.plan.upsert({
        where: { gameId_type: { gameId: game.id, type: p.type } },
        update: {},
        create: { gameId: game.id, ...p },
      });
    }
  }

  const email = (
    process.env.ADMIN_EMAIL ?? 'admin@lemattech.com'
  ).toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!password)
    throw new Error('ADMIN_PASSWORD must be set to seed the admin account');
  await prisma.user.upsert({
    where: { email },
    update: { role: Role.ADMIN },
    create: {
      email,
      name: 'LEMAT Admin',
      role: Role.ADMIN,
      passwordHash: await hashPassword(password),
    },
  });

  console.log(
    `Seeded ${GAMES.length + catalog.games.length} games (${catalog.games.length} from the games portal) x ${PLANS.length} plans and admin ${email}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
