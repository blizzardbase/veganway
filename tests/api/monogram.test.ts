// The monogram rules from brief 8: icon by category, palette tones only, and initials that skip
// articles, numbers and units and never mix scripts. Pure functions, no server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChefHat, Croissant, Leaf, Package, Utensils } from 'lucide-react';
import { MONO_TONES, initials, monogramStyle } from '../../src/ui/monogramRules.js';
import { membersRecommend, replyCount } from '../../src/lib/counts.js';

test('initials skip a leading article, numbers and units', () => {
  assert.equal(initials('Firm Organic Tofu 400g'), 'FO');
  assert.equal(initials('The Very Long Named Plant Based Mezze House of Dubai Hills'), 'VL');
  assert.equal(initials('A Little Bakery'), 'LB');
  assert.equal(initials('Oat Barista Milk 1L'), 'OB');
  assert.equal(initials('Tofu 400 g'), 'T');
  assert.equal(initials('zesty mango'), 'ZM');
  assert.equal(initials('The'), 'T');
  assert.equal(initials('123'), '?');
});

test('initials take one script only', () => {
  assert.equal(initials('بيت الفلافل Falafel House'), 'با');
  assert.equal(initials('Falafel House بيت الفلافل'), 'FH');
});

test('the monogram icon follows the category, then the kind, then a leaf', () => {
  assert.equal(monogramStyle('Tofu Theory', 'Restaurant').icon, Utensils);
  assert.equal(monogramStyle('Green Crumb', 'Bakery').icon, Croissant);
  assert.equal(monogramStyle('Plant Plate', 'Caterer').icon, ChefHat);
  assert.equal(monogramStyle('Firm Tofu', 'Other', 'product').icon, Package);
  assert.equal(monogramStyle('Somewhere', 'Other', 'place').icon, Leaf);
  for (const name of ['a', 'b', 'Tofu', 'بيت']) assert.ok(MONO_TONES.includes(monogramStyle(name, null).tone));
  // Every bakery shares a tone.
  assert.equal(monogramStyle('One', 'Bakery').tone, monogramStyle('Two', 'bakery').tone);
});

test('count copy reads as a sentence and is never 0', () => {
  assert.equal(membersRecommend(1), '1 member recommends');
  assert.equal(membersRecommend(12), '12 members recommend');
  assert.equal(replyCount(0), null);
  assert.equal(replyCount(1), '1 reply');
  assert.equal(replyCount(4), '4 replies');
});
