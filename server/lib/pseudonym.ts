// Playful pseudonyms: adjective + vegan food noun, e.g. "Saffron Chickpea".
import { randomInt } from 'node:crypto';
import type { Queryable } from '../db.js';

export const ADJECTIVES = [
  'Saffron', 'Sunny', 'Mellow', 'Curious', 'Cosy', 'Kind', 'Bright', 'Zesty', 'Toasty', 'Spicy',
  'Gentle', 'Breezy', 'Crispy', 'Golden', 'Jolly', 'Lucky', 'Merry', 'Nimble', 'Plucky', 'Quiet',
  'Rosy', 'Silky', 'Smoky', 'Snappy', 'Sparkly', 'Tangy', 'Velvet', 'Witty', 'Cheery', 'Dreamy',
  'Fluffy', 'Fresh', 'Happy', 'Humble', 'Lively', 'Minty', 'Peppery', 'Rustic', 'Sage', 'Sweet',
  'Swift', 'Tender', 'Wild', 'Warm', 'Bold', 'Calm', 'Clever', 'Dapper',
];

export const FOODS = [
  'Chickpea', 'Lentil', 'Falafel', 'Hummus', 'Tahini', 'Mango', 'Pistachio', 'Sesame', 'Olive', 'Coconut',
  'Date', 'Fig', 'Almond', 'Cashew', 'Walnut', 'Quinoa', 'Tofu', 'Tempeh', 'Seitan', 'Avocado',
  'Beetroot', 'Carrot', 'Pumpkin', 'Spinach', 'Okra', 'Eggplant', 'Zucchini', 'Mushroom', 'Pomegranate', 'Lime',
  'Lemon', 'Ginger', 'Turmeric', 'Cardamom', 'Cumin', 'Sumac', 'Zaatar', 'Mint', 'Basil', 'Oat',
  'Barley', 'Bulgur', 'Freekeh', 'Dal', 'Samosa', 'Dosa', 'Paratha', 'Kale',
];

export function generatePseudonym(): string {
  return `${ADJECTIVES[randomInt(ADJECTIVES.length)]} ${FOODS[randomInt(FOODS.length)]}`;
}

/** Names a member may not take, because they read as official roles. */
export function isReservedName(name: string): boolean {
  const canonical = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return /admin|moderator|staff|support|official|veganway|system|formermember/.test(canonical);
}

/** A free pseudonym. After 12 collisions it adds a two digit number. */
export async function availablePseudonym(db: Queryable, avoid?: string): Promise<string> {
  for (let i = 0; i < 24; i++) {
    const base = generatePseudonym();
    const name = i < 12 ? base : `${base} ${randomInt(10, 100)}`;
    if (avoid && name.toLowerCase() === avoid.toLowerCase()) continue;
    const taken = await db.maybeOne('SELECT 1 FROM users WHERE lower(pseudonym) = lower($1)', [name]);
    if (!taken) return name;
  }
  return `${generatePseudonym()} ${randomInt(1000, 10000)}`;
}
