// Launch-sniper bot for the pump.fun paper-trading replay (agent-fun/replay/v2).
// Buys a launch only in its first slots and only when its opening tape looks organic
// (few distinct buyers, creator has not sold), then exits fast: +15% take-profit,
// -12% stop loss, 10-slot time limit, sell at once if the creator sells. No clock, no
// randomness, no I/O — a pure function of the batches it is fed. The grader runs
// `node /bot/main.ts`; the strategy lives in strategy.ts and the SDK shim is vendored
// beside it (vendor/makefun-bot.ts is a byte-identical copy of sdk/ts/makefun-bot.ts).

// The strategy's settings (DEFAULT_PARAMS in strategy.ts) were picked on the dev
// window with a local sim: buy only organic-looking launches in their first five
// slots, exit fast (+15% / -12% / 10-slot limit / creator sell), stake 0.02 SOL.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
