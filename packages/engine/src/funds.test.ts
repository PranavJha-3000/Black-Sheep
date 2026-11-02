import { describe, expect, it } from 'vitest';
import { FUND_PROFILES, getFundProfile, getFundProfileByName } from './funds';
import { createInitialMarket } from './market';
import { MODEL_REGISTRY } from '../../../config/models';

describe('fund registry', () => {
  it('registers three funds with unique keys and names', () => {
    expect(FUND_PROFILES).toHaveLength(3);
    expect(new Set(FUND_PROFILES.map((p) => p.key)).size).toBe(3);
    expect(new Set(FUND_PROFILES.map((p) => p.name)).size).toBe(3);
  });

  it('gives each fund a distinct personality, a registered model and a sane risk limit', () => {
    expect(new Set(FUND_PROFILES.map((p) => p.personality)).size).toBe(3);
    for (const p of FUND_PROFILES) {
      expect(Object.keys(MODEL_REGISTRY)).toContain(p.model);
      expect(p.maxPositionFraction).toBeGreaterThan(0);
      expect(p.maxPositionFraction).toBeLessThanOrEqual(0.25);
      expect(p.mandate.length).toBeGreaterThan(0);
    }
  });

  it('staggers decision cadences so funds never all decide on the same tick', () => {
    const offsets = FUND_PROFILES.map((p) => p.decisionOffset);
    expect(new Set(offsets).size).toBe(offsets.length);
    for (const p of FUND_PROFILES) {
      expect(p.decisionEveryTicks).toBeGreaterThan(0);
      expect(p.decisionOffset).toBeGreaterThanOrEqual(0);
      expect(p.decisionOffset).toBeLessThan(p.decisionEveryTicks);
    }
  });

  it('looks profiles up by key and by name', () => {
    expect(getFundProfile('crown-meridian')?.name).toBe('CROWN MERIDIAN');
    expect(getFundProfileByName('STERLING & VALE')?.key).toBe('sterling-vale');
    expect(getFundProfile('nope')).toBeUndefined();
    expect(getFundProfileByName('APEX CAPITAL')).toBeUndefined();
  });
});

describe('market universe', () => {
  it('lists ten companies across at least seven sectors', () => {
    const m = createInitialMarket();
    const companies = Object.values(m.companies);
    expect(companies).toHaveLength(10);
    expect(new Set(companies.map((c) => c.sector)).size).toBeGreaterThanOrEqual(7);
    for (const c of companies) {
      expect(c.price).toBeGreaterThan(0);
      expect(c.liquidity).toBeGreaterThan(0);
    }
  });
});
