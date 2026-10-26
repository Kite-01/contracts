# @kite-01/contracts

## 2.0.0

### Major Changes

- b3686a1: `KiteFactory` is now upgradeable behind a transparent proxy and remembers every `Kite` implementation it has used, so each transfer keeps running the code it was created with. `Transfer` gains an `implementation` field, and a `poolFeeTier` of 0 now swaps through a Uniswap V2 router.
