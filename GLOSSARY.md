# BTC Up/Down

A game in which players guess whether the BTC/USD market price will be higher or lower one minute later. These terms are used consistently in code, UI and documentation.

## Market

**Trade**:
A single BTC/USD trade on the exchange, with a price and the exact moment it happened. Trades occur at irregular intervals.
_Avoid_: Tick, quote

**Market price** (at a moment):
The price of the last trade at or before that moment.
_Avoid_: Spot price, rate, value

**Display price**:
The market price shown to the player for orientation. It never decides an outcome.
_Avoid_: Live price, current price

## Game

**Player**:
An anonymous participant, recognised by the browser they play in.
_Avoid_: User, account

**Score**:
A player's running total of points. It starts at 0 and can be negative.
_Avoid_: Points, balance

**Guess**:
A player's prediction that the market price will be higher (`up`) or lower (`down`) after the guess window.
_Avoid_: Bet, prediction, wager

**Direction**:
The side of a guess: `up` or `down`.
_Avoid_: Side, choice

**Entry price**:
The market price at the moment the server received the guess.
_Avoid_: Start price, locked price, opening price

**Guess window**:
The 60 seconds after a guess is received, during which the guess cannot be resolved.
_Avoid_: Timeout, waiting period

**Deciding trade**:
The trade whose price is compared with the entry price to decide the outcome.
_Avoid_: Exit, resolution price, closing price

**Outcome**:
Whether a resolved guess was `won` (+1) or `lost` (−1).
_Avoid_: Correct/incorrect, win/loss, result

## Guess lifecycle

**Locking**:
The guess has been received, and its entry price is not yet known.

**Open**:
The entry price is known, and the guess window is still running.

**Waiting**:
The guess window has ended, but the market price still equals the entry price.

**Resolved**:
The deciding trade is known, the outcome is final, and the score has changed.
_Avoid_: Settled, closed, finished
