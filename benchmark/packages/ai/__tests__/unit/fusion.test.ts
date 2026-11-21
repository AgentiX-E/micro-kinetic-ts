import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FUSION_OPTIONS,
  FUSION_STRATEGIES,
  RANK_STRATEGIES,
  fuseClaims,
  fuseRanks,
  impliedOrder,
} from '../../src/agent/fusion.js';
import type { EliminationClaim } from '../../src/agent/hypothesis-space.js';

function claim(remove: string, keep: string): EliminationClaim {
  return {
    remove,
    keep,
    because: { channel: 'latency', statistic: 'post', observed: 9, band: [1, 2] },
  };
}

/** The engine's order used by most cases: five services, best first. */
const ENGINE: readonly string[] = ['mysql', 'cache', 'gateway', 'auth', 'billing'];

describe('impliedOrder', () => {
  it('returns the engine order untouched when no claim names a ranked service', () => {
    // The property the control arm rests on: "the ranking is already right" is an empty list, and an empty list
    // must fuse to a no-op rather than to an arbitrary permutation.
    expect(impliedOrder(ENGINE, [])).toEqual(ENGINE);
  });

  it('promotes a kept service over the removed one', () => {
    expect(impliedOrder(ENGINE, [claim('mysql', 'gateway')])).toEqual([
      'gateway',
      'mysql',
      'cache',
      'auth',
      'billing',
    ]);
  });

  it('reads two claims in opposite directions as a tie and keeps the engine order', () => {
    // Credit is a count, not an edge: a cycle has no topological order, so the operator states the count and lets
    // the engine break the tie. A topological sort here would have to invent an order the artifact does not carry.
    const order = impliedOrder(ENGINE, [claim('mysql', 'cache'), claim('cache', 'mysql')]);
    expect(order).toEqual(ENGINE);
  });

  it('keeps a service the engine never ranked at the tail, in first-seen order', () => {
    const order = impliedOrder(ENGINE, [claim('mysql', 'stranger'), claim('mysql', 'other')]);
    expect(order.slice(0, 5)).toEqual(['stranger', 'other', 'mysql', 'cache', 'gateway']);
    expect(order.slice(5)).toEqual(['auth', 'billing']);
    expect([...order].sort()).toEqual([
      'auth',
      'billing',
      'cache',
      'gateway',
      'mysql',
      'other',
      'stranger',
    ]);
  });

  it('ties on engine rank rather than on arrival order', () => {
    // Two claims each promote one service; both have credit 1, so the engine's order decides, not the order the
    // claims were recorded in.
    const forwards = impliedOrder(ENGINE, [claim('mysql', 'auth'), claim('mysql', 'cache')]);
    const backwards = impliedOrder(ENGINE, [claim('mysql', 'cache'), claim('mysql', 'auth')]);
    expect(forwards).toEqual(['cache', 'auth', 'mysql', 'gateway', 'billing']);
    expect(forwards).toEqual(backwards);
  });

  it('breaks a tie between two unranked services by first appearance', () => {
    const order = impliedOrder(ENGINE, [claim('mysql', 'zeta'), claim('mysql', 'alpha')]);
    expect(order.indexOf('zeta')).toBeLessThan(order.indexOf('alpha'));
  });

  it('orders three unranked services by first appearance, which is the last tie-break', () => {
    // Three is the smallest count that forces the comparator to reach its final arm twice: all three have the same
    // promotion count and no engine rank, so only first appearance separates them.
    const order = impliedOrder(ENGINE, [
      claim('mysql', 'zeta'),
      claim('mysql', 'alpha'),
      claim('mysql', 'beta'),
    ]);
    expect(order.slice(0, 3)).toEqual(['zeta', 'alpha', 'beta']);
  });

  it('keeps the first position of a repeated engine service', () => {
    const order = impliedOrder(['b', 'a', 'b'], []);
    expect(order).toEqual(['b', 'a']);
  });

  it('counts a service mentioned twice ahead of one mentioned once', () => {
    const order = impliedOrder(ENGINE, [claim('mysql', 'gateway'), claim('auth', 'gateway')]);
    expect(order[0]).toBe('gateway');
  });
});

describe('fuseRanks', () => {
  it('returns the engine order unchanged at weight zero, for every strategy', () => {
    for (const strategy of RANK_STRATEGIES) {
      const fused = fuseRanks(ENGINE, ['billing', 'auth', 'gateway', 'cache', 'mysql'], {
        strategy,
        weight: 0,
        rrfK: 60,
      });
      expect(fused).toEqual(ENGINE);
    }
  });

  it('fuses an empty engine order to nothing', () => {
    expect(fuseRanks([], ['mysql'], { strategy: 'rrf', weight: 1, rrfK: 60 })).toEqual([]);
  });

  it('uses the default options when none are given', () => {
    expect(DEFAULT_FUSION_OPTIONS).toEqual({ strategy: 'rrf', weight: 0, rrfK: 60 });
    expect(fuseRanks(ENGINE, ['billing'])).toEqual(ENGINE);
  });

  it('promotes under RRF when the second order puts a service first', () => {
    const fused = fuseRanks(ENGINE, ['auth', 'billing', 'gateway', 'cache', 'mysql'], {
      strategy: 'rrf',
      weight: 1,
      rrfK: 60,
    });
    expect(fused[0]).toBe('auth');
    expect(fused).toHaveLength(ENGINE.length);
  });

  it('promotes under Borda when the second order puts a service first', () => {
    const fused = fuseRanks(ENGINE, ['auth', 'billing', 'gateway', 'cache', 'mysql'], {
      strategy: 'borda',
      weight: 1,
      rrfK: 60,
    });
    expect(fused[0]).toBe('auth');
    expect(fused).toHaveLength(ENGINE.length);
  });

  it('scores a service the second order omits on the engine order alone', () => {
    // A second order naming one service out of five must not rank the other four as "second": absence is absence,
    // and the first attempt at this function did exactly that, which turned a nearly empty opinion into a nearly
    // full one and promoted a service nobody had spoken for.
    const fused = fuseRanks(ENGINE, ['auth'], { strategy: 'borda', weight: 1, rrfK: 60 });
    expect(fused[0]).toBe('auth');
    expect(fused.slice(1)).toEqual(['mysql', 'cache', 'gateway', 'billing']);
  });

  it('ignores a service the second order names but the engine never ranked', () => {
    const fused = fuseRanks(ENGINE, ['stranger', 'mysql'], {
      strategy: 'rrf',
      weight: 1,
      rrfK: 60,
    });
    expect(fused).not.toContain('stranger');
    expect([...fused].sort()).toEqual([...ENGINE].sort());
  });

  it('leaves the order alone when the second order agrees with the engine', () => {
    for (const strategy of RANK_STRATEGIES) {
      expect(fuseRanks(ENGINE, ENGINE, { strategy, weight: 5, rrfK: 60 })).toEqual(ENGINE);
    }
  });

  it('reads a repeated service in the second order at first sight', () => {
    // A second order that lists the same service twice is a defect, and the first position is the only one that
    // can be a position: reading the later duplicate would let a malformed order demote the service it names.
    const repeated = fuseRanks(ENGINE, ['auth', 'mysql', 'auth'], {
      strategy: 'rrf',
      weight: 1,
      rrfK: 60,
    });
    const once = fuseRanks(ENGINE, ['auth', 'mysql'], { strategy: 'rrf', weight: 1, rrfK: 60 });
    expect(repeated).toEqual(once);
  });

  it('states that the choice between RRF and Borda changes the answer', () => {
    // The two operators disagree on this input: RRF weights position by 1/(k + rank), which favours the second
    // order's top pick, while Borda weights it linearly, which favours the service both orders rank high. That is
    // why the strategy is a parameter and not a constant — the choice is measurable, so it has to be measurable.
    const second = ['auth', 'gateway', 'billing', 'cache', 'mysql'];
    expect(fuseRanks(ENGINE, second, { strategy: 'rrf', weight: 1, rrfK: 60 })[0]).toBe('auth');
    expect(fuseRanks(ENGINE, second, { strategy: 'borda', weight: 1, rrfK: 60 })[0]).toBe(
      'gateway',
    );
  });
});

describe('fuseClaims', () => {
  it('returns the engine order at weight zero for every strategy, veto included', () => {
    for (const strategy of FUSION_STRATEGIES) {
      expect(
        fuseClaims(ENGINE, [claim('mysql', 'billing')], { strategy, weight: 0, rrfK: 60 }),
      ).toEqual(ENGINE);
    }
  });

  it('fuses an empty engine order to nothing', () => {
    expect(fuseClaims([], [claim('a', 'b')], { strategy: 'veto', weight: 1, rrfK: 60 })).toEqual(
      [],
    );
  });

  it('delegates rrf and borda to the implied order', () => {
    const claims = [claim('mysql', 'gateway')];
    const implied = impliedOrder(ENGINE, claims);
    for (const strategy of RANK_STRATEGIES) {
      expect(fuseClaims(ENGINE, claims, { strategy, weight: 1, rrfK: 60 })).toEqual(
        fuseRanks(ENGINE, implied, { strategy, weight: 1, rrfK: 60 }),
      );
    }
  });

  it('applies a veto only at full weight, because a veto has no half', () => {
    // 0.5 is not a weaker veto, it is a number nobody defined; the operator states that rather than inventing an
    // interpolation that no reader could check.
    expect(
      fuseClaims(ENGINE, [claim('mysql', 'billing')], { strategy: 'veto', weight: 0.5, rrfK: 60 }),
    ).toEqual(ENGINE);
    expect(
      fuseClaims(ENGINE, [claim('mysql', 'billing')], { strategy: 'veto', weight: 1, rrfK: 60 })[0],
    ).toBe('billing');
  });

  it('moves a service that already stands first not at all', () => {
    const claims = [claim('gateway', 'mysql')];
    expect(fuseClaims(ENGINE, claims, { strategy: 'veto', weight: 1, rrfK: 60 })).toEqual(ENGINE);
  });

  it('skips a claim naming a service the engine never ranked', () => {
    const claims = [claim('mysql', 'stranger'), claim('stranger', 'billing')];
    const fused = fuseClaims(ENGINE, claims, { strategy: 'veto', weight: 1, rrfK: 60 });
    expect(fused).toEqual(ENGINE);
  });

  it('skips a claim that removes and keeps the same service', () => {
    const claims = [claim('mysql', 'mysql')];
    expect(fuseClaims(ENGINE, claims, { strategy: 'veto', weight: 1, rrfK: 60 })).toEqual(ENGINE);
  });

  it('applies a pair stated in both directions once, in its first-recorded direction', () => {
    // Otherwise the two statements undo each other and the result depends on which was read last, which would make
    // a recorded artifact order-dependent in a way the digest does not describe.
    const forward = fuseClaims(ENGINE, [claim('mysql', 'cache'), claim('cache', 'mysql')], {
      strategy: 'veto',
      weight: 1,
      rrfK: 60,
    });
    const backward = fuseClaims(ENGINE, [claim('cache', 'mysql'), claim('mysql', 'cache')], {
      strategy: 'veto',
      weight: 1,
      rrfK: 60,
    });
    expect(forward).toEqual(['cache', 'mysql', 'gateway', 'auth', 'billing']);
    expect(backward).toEqual(['mysql', 'cache', 'gateway', 'auth', 'billing']);
  });

  it('applies the deepest move first, so one move cannot shift the anchor of another', () => {
    // Two promotions whose anchors are at different depths. Applying the shallow one first would slide the deeper
    // anchor down by one and land the second service where nobody stated; the deepest-first order makes the result
    // a function of the claims rather than of their depth.
    const claims = [claim('gateway', 'billing'), claim('mysql', 'auth')];
    const fused = fuseClaims(ENGINE, claims, { strategy: 'veto', weight: 1, rrfK: 60 });
    expect(fused).toEqual(['auth', 'mysql', 'cache', 'billing', 'gateway']);
  });

  it('names every strategy it implements', () => {
    expect([...RANK_STRATEGIES]).toEqual(['rrf', 'borda']);
    expect([...FUSION_STRATEGIES]).toEqual(['rrf', 'borda', 'veto']);
  });
});
