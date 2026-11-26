import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSellingPriceAgainstHpp,
  generateOwnerPricingSuggestions,
  roundMenuSellingPrice,
} from './hppPricing';

test('roundMenuSellingPrice rounds cleanly to Rp 500 below 20k and Rp 1000 at/above 20k', () => {
  assert.equal(roundMenuSellingPrice(0), 0);
  assert.equal(roundMenuSellingPrice(420), 1000);
  assert.equal(roundMenuSellingPrice(12100), 12500);
  assert.equal(roundMenuSellingPrice(19500), 19500);
  assert.equal(roundMenuSellingPrice(20100), 21000);
  assert.equal(roundMenuSellingPrice(28333), 29000);
});

test('generateOwnerPricingSuggestions returns empty array when HPP is 0 or negative', () => {
  assert.deepEqual(generateOwnerPricingSuggestions(0), []);
  assert.deepEqual(generateOwnerPricingSuggestions(-500), []);
});

test('generateOwnerPricingSuggestions returns 3 ascending tiers with accurate food cost & profit', () => {
  const hpp = 9000;
  const suggestions = generateOwnerPricingSuggestions(hpp);

  assert.equal(suggestions.length, 3);
  assert.deepEqual(
    suggestions.map((s) => s.id),
    ['competitive', 'ideal', 'premium']
  );

  // Competitive: 9000 / 0.35 = 25714 -> 26000
  // Ideal: 9000 / 0.30 = 30000 -> 30000
  // Premium: 9000 / 0.25 = 36000 -> 36000
  assert.equal(suggestions[0].suggestedPrice, 26000);
  assert.equal(suggestions[1].suggestedPrice, 30000);
  assert.equal(suggestions[1].recommended, true);
  assert.equal(suggestions[2].suggestedPrice, 36000);

  for (const s of suggestions) {
    assert.equal(s.estimatedProfit, s.suggestedPrice - hpp);
    assert.ok(s.actualFoodCostPercent <= s.targetFoodCostPercent + 0.01);
    assert.ok(Math.abs(s.actualFoodCostPercent + s.actualMarginPercent - 100) < 0.01);
  }
});

test('evaluateSellingPriceAgainstHpp accurately classifies loss, thin, fair, healthy, and high margins', () => {
  assert.equal(evaluateSellingPriceAgainstHpp(30000, 0).status, 'no_hpp');
  assert.equal(evaluateSellingPriceAgainstHpp(0, 9000).status, 'missing_price');
  assert.equal(evaluateSellingPriceAgainstHpp(8500, 9000).status, 'loss');
  assert.equal(evaluateSellingPriceAgainstHpp(9000, 9000).status, 'loss');
  assert.equal(evaluateSellingPriceAgainstHpp(20000, 9000).status, 'thin'); // 45% FC
  assert.equal(evaluateSellingPriceAgainstHpp(26000, 9000).status, 'fair'); // 34.6% FC
  assert.equal(evaluateSellingPriceAgainstHpp(30000, 9000).status, 'healthy'); // 30% FC
  assert.equal(evaluateSellingPriceAgainstHpp(55000, 9000).status, 'high'); // 16.4% FC
});
