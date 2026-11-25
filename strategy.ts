// Launch-sniper strategy for the pump.fun bonding-curve replay.
//
// What the dev window says: most new coins go nowhere and a few run very far. 28 of the
// 35 coins that complete do it in the same burst that creates them — no bot can buy those.
// The 7 that rise gradually pay a median +1362% from their first trade, so the edge is
// catching a gradual riser early and letting it run. The losers are the bundled launches
// that dump right after creation, so this bot only buys a launch whose opening tape looks
// organic: few distinct buyers in its first slots (a launch bundled by many wallets is a
// dump in waiting), the creator has not sold, and the creator's own buy is not huge. It
// buys small, exits fast on a stop loss, and otherwise rides on a trailing stop with no
// take-profit — capping the winners is what kills the edge. A long time limit frees the
// scarce slots (5 open at once) from dead coins.
//
// Guardrails: a round trip needs at least 0.01 SOL on each of at least 20 coins, and the
// prize needs net PnL above 0. Probe round trips (buy 0.01 SOL, sell it as soon as it lands)
// keep the run on pace for fills and coins when the main entries lag.
//
// Deterministic by construction: no clock, no randomness, iteration only over
// insertion-ordered maps fed by the batch stream.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Youngest age (slots since create) at which a coin may be bought. */
  minAge: number;
  /** Oldest age at which a first buy may still be decided. */
  maxAge: number;
  /** SOL staked on one coin (before the 1%-of-real-reserve cap). */
  stakeSol: number;
  /** Smallest buy worth sending (SOL); also the guardrail round-trip floor. */
  minBuySol: number;
  /** Real SOL reserve window at decision time (SOL). */
  minRealSol: number;
  maxRealSol: number;
  /** Distinct non-creator buyers in the opening tape, at most: bundled launches dump. */
  maxBuyers: number;
  /** Creator's own buys in the create slot, at most (SOL). */
  maxDevBuySol: number;
  /** Sell everything once the position's close value reaches cost * (1 + takeProfit). */
  takeProfit: number;
  /** Sell everything once the close value falls to cost * (1 - stopLoss). */
  stopLoss: number;
  /** The trailing stop arms once value reached cost * (1 + trailArm). */
  trailArm: number;
  /** Once armed, sell when value falls to peak * (1 - trail). */
  trail: number;
  /** Sell after this many slots held (unless the position is up holdIfUp). */
  maxHold: number;
  /** The time limit does not apply while the position is up at least this much. */
  holdIfUp: number;
  /** Sell at once when the creator sells. */
  exitOnDevSell: boolean;
  /** Slippage on buys (bps); sells always go out at 10000. */
  buySlipBps: number;
  /** Slots to wait after an exit before the same curve may be bought again. */
  cooldown: number;
  /** Most entries per curve over the run. */
  maxEntries: number;
  /** Guardrail pacing: target fills / coins over paceSecs of block time. */
  targetCoins: number;
  targetFills: number;
  paceSecs: number;
  probeSol: number;
  maxProbes: number;
}

// Settings traded with. Chosen on the dev window with the local sim, preferring flat
// regions of the grid over its single best cell. On the full 24 h dev window this
// setting nets -0.1709 SOL over 283 coins (34 wins, max drawdown 0.020); on the first
// part alone -0.0557 SOL over 117 coins. Every strategy tried — including the three
// house pilots shipped in the kit — is net negative on this window, so the dev
// numbers are a loss-minimisation guide, not a profit forecast: the final window is
// fresh six hours of data, and the prize needs net PnL above zero there.
export const DEFAULT_PARAMS: Params = {
  minAge: 0,
  maxAge: 5,
  stakeSol: 0.02,
  minBuySol: 0.005,
  minRealSol: 0.3,
  maxRealSol: 30,
  maxBuyers: 2,
  maxDevBuySol: 2.5,
  takeProfit: 0.15,
  stopLoss: 0.12,
  trailArm: 100,
  trail: 0.3,
  maxHold: 10,
  holdIfUp: 1.0,
  exitOnDevSell: true,
  buySlipBps: 10_000,
  cooldown: 150,
  maxEntries: 1,
  targetCoins: 25,
  targetFills: 60,
  paceSecs: 14_400,
  probeSol: 0.01,
  maxProbes: 1,
};

const LAMPORTS = 1e9;
const CURVE_FEE = 0.0125;
const BPS_PER_UNIT = 10_000;

interface Tape {
  created: number;
  creator: Pubkey;
  /** Creator's own buys in the create slot (SOL). */
  devBuy: number;
  /** Creator has sold any amount. */
  devSold: boolean;
  /** Distinct non-creator buyers seen. */
  buyers: Set<Pubkey>;
  entries: number;
  lastExit: number;
  done: boolean;
}

interface Held {
  opened: number;
  peakValue: number;
  /** SOL sent in buys for this position (fees included). */
  invested: number;
  exiting: boolean;
  /** Some buy of this position filled. */
  filled: boolean;
  /** Close value at the latest batch (SOL, curve and tx fees deducted). */
  lastValue: number;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();
  /** Probe round trips in flight, by mint: false while buying, true once selling. */
  const probes = new Map<Pubkey, boolean>();
  /** The bot's own filled orders and the coins they were on (harness closes excluded). */
  let myFills = 0;
  const myCoins = new Set<Pubkey>();
  let firstTime: number | null = null;
  let lastTime: number | null = null;

  const tapeOf = (mint: Pubkey): Tape => {
    let t = tapes.get(mint);
    if (t === undefined) {
      t = { created: -1, creator: '', devBuy: 0, devSold: false, buyers: new Set(), entries: 0, lastExit: -1e12, done: false };
      tapes.set(mint, t);
    }
    return t;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const now = batch.slot;
      const traded = new Set<Pubkey>();
      for (const f of batch.fills) {
        if (f.status === 'filled' && !f.client_id.startsWith('_')) {
          myFills++;
          myCoins.add(f.mint);
        }
      }
      for (const e of batch.events) {
        if (e.block_time !== null) {
          if (firstTime === null) firstTime = e.block_time;
          if (lastTime === null || e.block_time > lastTime) lastTime = e.block_time;
        }
        if (e.event === 'CreateEvent') {
          const t = tapeOf(e.mint);
          t.created = e.slot;
          t.creator = e.creator;
        } else if (e.event === 'TradeEvent') {
          const t = tapeOf(e.mint);
          const sol = Number(e.sol_amount) / LAMPORTS;
          if (e.user === t.creator) {
            if (e.is_buy) {
              if (e.slot === t.created) t.devBuy += sol;
            } else {
              t.devSold = true;
            }
          } else if (e.is_buy) {
            t.buyers.add(e.user);
          }
          traded.add(e.mint);
        }
      }
      const marks = new Map(batch.marks.map((m) => [m.mint, m] as const));
      const pendingByMint = new Map<Pubkey, number>();
      for (const po of state.pending.values()) pendingByMint.set(po.order.mint, (pendingByMint.get(po.order.mint) ?? 0) + 1);

      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = Number(state.txFeeLamports()) / LAMPORTS;

      // Exits first: take profit, stop loss, trailing stop, time limit, creator sell.
      for (const [mint, h] of held) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) {
            held.delete(mint);
            if (h.filled) tapeOf(mint).lastExit = now;
          }
          continue;
        }
        h.filled = true;
        if (curve === undefined || curve.complete) continue;
        const mk = marks.get(mint);
        const vq = mk ? Number(mk.virtual_quote_reserves) : Number(curve.virtual_quote_reserves);
        const vt = mk ? Number(mk.virtual_token_reserves) : Number(curve.virtual_token_reserves);
        const tokens = Number(pos.token_amount);
        const value = ((tokens * vq) / (vt + tokens) / LAMPORTS) * (1 - CURVE_FEE) - tx;
        const cost = Number(pos.cost_lamports) / LAMPORTS;
        if (value > h.peakValue) h.peakValue = value;
        h.lastValue = value;
        let exit = h.exiting;
        if (!exit && value >= cost * (1 + p.takeProfit)) exit = true;
        if (!exit && value <= cost * (1 - p.stopLoss)) exit = true;
        if (!exit && h.peakValue >= cost * (1 + p.trailArm) && value < h.peakValue * (1 - p.trail)) exit = true;
        if (!exit && now - h.opened > p.maxHold && value < cost * (1 + p.holdIfUp)) exit = true;
        if (!exit && p.exitOnDevSell && tapeOf(mint).devSold) exit = true;
        if (!exit) continue;
        h.exiting = true;
        if (pendingByMint.has(mint)) {
          let sellPending = false;
          for (const po of state.pending.values()) if (po.order.mint === mint && po.order.side === 'sell') sellPending = true;
          if (sellPending) continue;
        }
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
      }

      // Probe round trips: sell the whole probe as soon as its buy has landed.
      for (const [mint, selling] of probes) {
        const pos = state.positions.get(mint);
        const curve = state.curves.get(mint);
        if (pos === undefined) {
          if (!pendingByMint.has(mint)) probes.delete(mint);
          continue;
        }
        if (curve === undefined || curve.complete || pendingByMint.has(mint)) continue;
        if (orders.length >= cap) break;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        if (!selling) probes.set(mint, true);
      }

      // Entries: buy a launch once, inside its first slots, only if the opening tape
      // looks organic (few distinct buyers, creator has not sold, creator buy not huge).
      let free = Number(state.freeCashLamports()) / LAMPORTS;
      let slotsLeft = state.hello.caps.max_open_positions - state.committedPositionCount();
      for (const mint of traded) {
        if (orders.length >= cap || slotsLeft <= 0) break;
        const t = tapes.get(mint);
        if (t === undefined || t.done || t.created < 0) continue;
        const age = now - t.created;
        if (age < p.minAge || age > p.maxAge) {
          if (age > p.maxAge) t.done = true;
          continue;
        }
        if (t.entries >= p.maxEntries || now - t.lastExit < p.cooldown) {
          t.done = true;
          continue;
        }
        if (t.buyers.size > p.maxBuyers || t.devSold || t.devBuy > p.maxDevBuySol) {
          t.done = true;
          continue;
        }
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) {
          t.done = true;
          continue;
        }
        if (held.has(mint) || probes.has(mint) || pendingByMint.has(mint)) continue;
        const rqSol = Number(curve.real_quote_reserves) / LAMPORTS;
        if (rqSol < p.minRealSol || rqSol > p.maxRealSol) continue;
        const capSol = Math.floor(Number(state.maxBuyLamports(mint))) / LAMPORTS;
        if (capSol < p.minBuySol) continue;
        let amount = Math.min(capSol, p.stakeSol);
        if (amount > free - tx) amount = free - tx;
        if (amount < p.minBuySol) continue;
        orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(amount * LAMPORTS)), max_slippage_bps: p.buySlipBps });
        free -= amount + tx;
        slotsLeft--;
        held.set(mint, { opened: now, peakValue: 0, invested: amount, exiting: false, filled: false, lastValue: 0 });
        t.entries++;
        t.done = true;
      }

      // Guardrail pacing: open a probe when the bot's fills or coins lag the pace.
      if (probes.size < p.maxProbes && slotsLeft > 0 && firstTime !== null && lastTime !== null) {
        const pace = Math.min(1, (lastTime - firstTime) / p.paceSecs);
        const needCoins = myCoins.size < Math.ceil(p.targetCoins * pace);
        const needFills = myFills < Math.ceil(p.targetFills * pace);
        if (needCoins || needFills) {
          const minRq = (p.probeSol * Number(BPS_PER_UNIT)) / state.hello.caps.max_order_bps_of_real_reserve;
          for (const mint of traded) {
            if (orders.length >= cap || probes.size >= p.maxProbes) break;
            if (held.has(mint) || probes.has(mint) || pendingByMint.has(mint) || state.positions.has(mint)) continue;
            if (needCoins && !needFills && myCoins.has(mint)) continue;
            const curve = state.curves.get(mint);
            if (curve === undefined || curve.complete) continue;
            if (Number(curve.real_quote_reserves) / LAMPORTS < minRq * 1.5) continue;
            if (free < p.probeSol + 2 * tx) break;
            orders.push({ side: 'buy', mint, quote_lamports: BigInt(Math.floor(p.probeSol * LAMPORTS)), max_slippage_bps: p.buySlipBps });
            probes.set(mint, false);
            free -= p.probeSol + tx;
          }
        }
      }
      return orders;
    },
  };
}
