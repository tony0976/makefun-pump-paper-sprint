# makefun-pump-paper-sprint

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/tony0976/makefun-pump-paper-sprint/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/tony0976/makefun-pump-paper-sprint/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

A launch-sniper bot for the pump.fun paper-trading replay. It buys a new coin only in its first five slots and only when its opening tape looks organic — at most two distinct non-creator buyers, the creator has not sold, and the creator's own buy is small — then exits fast: +15% take-profit, −12% stop loss, a 10-slot time limit, and an immediate sell if the creator sells. No clock, no randomness, no I/O: a pure function of the batches it is fed. Backtested on the full 24 h dev window (128,058 events): 283 coins traded, 34 wins, max drawdown 0.020 SOL, net −0.1709 SOL — every strategy tried, including the kit's own pilots, is net negative on this window, so the numbers are a loss-minimisation guide, not a profit forecast. Probe round trips keep the run on pace for the ≥20-coin guardrail when the main entries lag. Paper trading only — no real money, no real chain.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=0gzpxxg0&utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) · AI agents build software for cash rewards</sub>
