import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_MEMBERSHIP_PROGRAM,
  computeTierBySpend,
  getPromoStatus,
  isNewMemberPromoEligible,
  validatePromoClaim,
  validateRewardRedemption,
} from './membershipProgram';
import type { Customer, MemberRedemptionLog } from '../types';

const sampleGoldCustomer: Customer = {
  id: 'cust-gold',
  name: 'Andi Wijaya',
  phone_number: '081200001111',
  email: 'andi@example.com',
  points: 180,
  tier: 'Gold',
  total_spent: 4500000,
  created_at: '2026-06-01T00:00:00.000Z',
};

describe('membershipProgram pure validation rules', () => {
  it('enforces minimum points, daily free-product limit, per-member limit, and total quota', () => {
    const reward = DEFAULT_MEMBERSHIP_PROGRAM.rewards[0]; // 50 pts, max 3/member, quota 60
    const limits = {
      ...DEFAULT_MEMBERSHIP_PROGRAM.limits,
      min_points_to_redeem: 50,
      max_free_products_per_day: 2,
      max_free_products_per_month: 5,
    };
    const now = new Date('2026-11-25T10:00:00.000Z');

    // Valid first redemption
    const okRes = validateRewardRedemption({
      customer: sampleGoldCustomer,
      reward,
      limits,
      logs: [],
      now,
    });
    assert.equal(okRes.ok, true);

    // Fails when daily limit (2) already reached
    const todayLogs: MemberRedemptionLog[] = [
      {
        id: 'l1',
        customer_id: sampleGoldCustomer.id,
        customer_name: sampleGoldCustomer.name,
        reward_id: reward.id,
        label: 'Free 1',
        points_spent: 50,
        redeemed_at: '2026-11-25T08:00:00.000Z',
      },
      {
        id: 'l2',
        customer_id: sampleGoldCustomer.id,
        customer_name: sampleGoldCustomer.name,
        reward_id: reward.id,
        label: 'Free 2',
        points_spent: 50,
        redeemed_at: '2026-11-25T09:00:00.000Z',
      },
    ];
    const dailyExceeded = validateRewardRedemption({
      customer: sampleGoldCustomer,
      reward,
      limits,
      logs: todayLogs,
      now,
    });
    assert.equal(dailyExceeded.ok, false);

    // Fails when total quota reached
    const fullQuota = validateRewardRedemption({
      customer: sampleGoldCustomer,
      reward: { ...reward, redeemed_count: reward.total_quota },
      limits,
      logs: [],
      now,
    });
    assert.equal(fullQuota.ok, false);
  });

  it('enforces promo period, eligible tier, customer quota, and per-member claim limit', () => {
    const vipPromo = DEFAULT_MEMBERSHIP_PROGRAM.promos[1]; // Gold & Platinum, 2026-11-15..2026-12-20, max 2/member, quota 50
    const activeDate = new Date('2026-11-25T12:00:00.000Z');
    const expiredDate = new Date('2027-01-05T12:00:00.000Z');

    assert.equal(getPromoStatus(vipPromo, activeDate), 'active');
    assert.equal(getPromoStatus(vipPromo, expiredDate), 'expired');

    // Silver member rejected on Gold/Platinum promo
    const silverCheck = validatePromoClaim({
      customer: { ...sampleGoldCustomer, tier: 'Silver' },
      promo: vipPromo,
      logs: [],
      now: activeDate,
    });
    assert.equal(silverCheck.ok, false);

    // Gold member accepted when within period & quota
    const goldCheck = validatePromoClaim({
      customer: sampleGoldCustomer,
      promo: vipPromo,
      logs: [],
      now: activeDate,
    });
    assert.equal(goldCheck.ok, true);

    // Rejected when global customer quota full
    const fullCheck = validatePromoClaim({
      customer: sampleGoldCustomer,
      promo: { ...vipPromo, claimed_count: vipPromo.max_customer_quota },
      logs: [],
      now: activeDate,
    });
    assert.equal(fullCheck.ok, false);
  });

  it('computes tier upgrades using custom Owner tier thresholds and evaluates new member promo eligibility', () => {
    const customTiers = DEFAULT_MEMBERSHIP_PROGRAM.tiers.map((t) =>
      t.tier === 'Gold' ? { ...t, min_total_spent: 2000000 } : t
    );
    assert.equal(computeTierBySpend(2100000, customTiers), 'Gold');
    assert.equal(computeTierBySpend(8500000, customTiers), 'Platinum');

    assert.equal(
      isNewMemberPromoEligible(DEFAULT_MEMBERSHIP_PROGRAM.limits, new Date('2026-11-25T10:00:00.000Z')),
      true
    );
    assert.equal(
      isNewMemberPromoEligible(
        {
          ...DEFAULT_MEMBERSHIP_PROGRAM.limits,
          new_member_claimed_count: DEFAULT_MEMBERSHIP_PROGRAM.limits.new_member_max_quota,
        },
        new Date('2026-11-25T10:00:00.000Z')
      ),
      false
    );
  });
});
