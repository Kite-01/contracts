# Kite Contracts

The smart contracts behind [Kite](https://github.com/Kite-01/server), an open-source crypto payment processor. Each payment gets its own contract, deployed at an address known before anyone pays, which receives the customer's tokens, swaps them if needed, pays fees and settles to the merchant, or refunds the customer.

## How it works

A Kite server creates a transfer: who gets paid, in which token, the minimum to receive, fees, a refund address and an expiry.

1. **Before payment**: `KiteFactory.predictAddress(transfer)` gives the address the customer pays into. Nothing is deployed yet.
2. **Settling**: once funds arrive, the operator calls `KiteFactory.settle(transfer)`. That deploys a clone of `Kite` at the predicted address and settles it in one transaction: swap through Uniswap if the customer paid in another token (a V3 pool, or a V2 pair when `poolFeeTier` is 0), pay each fee, and send the rest to the merchant. Anything the customer overpaid goes back to them.
3. **Refunding**: `KiteFactory.refund(transfer)` returns whatever the contract holds to the refund address. Before expiry only the operator can call it; after expiry anyone can, so a customer is never stuck waiting on the server.
4. **Recovering**: `KiteFactory.recover(transfer, token, to)` lets the operator retrieve tokens left behind, such as ones sent after settlement or a refund the refund address couldn't accept.

`deploy`, `settle` and `recover` need the operator role, which the admin grants.

Details worth knowing:

- Native ETH and any ERC-20 can be paid in or settled.
- A refund the refund address can't accept, such as a contract that rejects ETH, never blocks settlement or leaves the transfer open. The amount stays in the clone for the operator to `recover`, and `Refunded` reports what was actually sent.
- `Recovered` reports the address the tokens were actually sent to.
- A clone can't be re-initialised or driven by anyone but the factory.

## Upgrades

`KiteFactory` sits behind a transparent proxy, so its address never changes. The proxy creates a `ProxyAdmin`, owned by the admin, which is the only way to upgrade it:

- **Factory code**: deploy a new `KiteFactory` and call `upgradeAndCall(proxy, newFactory, 0x)` on the `ProxyAdmin`.
- **`Kite` code**: deploy a `Kite` with the proxy's address and call `setImplementation(newKite)` on the factory as the admin. Only transfers created afterwards use it.

Each transfer names the `Kite` implementation it runs (`transfer.implementation`, read from `implementation()` when the transfer is created). The factory accepts any implementation it has ever used, so a transfer created before an upgrade still settles, refunds and recovers with the code it was created with, and no upgrade can change the code of a clone that already holds funds.

## Using the package

The server uses the published package for ABIs and typed bindings:

```sh
npm install @kite-01/contracts
```

```ts
import { Kite__factory } from "@kite-01/contracts/typechain/factories/contracts/Kite__factory.js";
```

It exports the Solidity sources (`@kite-01/contracts/contracts/*`), the compiled artifacts (`@kite-01/contracts/artifacts/*`) and the TypeChain bindings (`@kite-01/contracts/typechain/*`).

## Deployments

| Network               | `KiteFactory`                                |
| --------------------- | -------------------------------------------- |
| Base Sepolia (84532)  | `0x8993cFd318Ded220381f37d6209027D36B6CF117` |
| Monad Testnet (10143) | `0x60c39c24619be51bC7Ef1B82EaE6d922f9F6da1E` |

The full deployment records are in `ignition/deployments/`.

## Development

You need Node.js 22.13 or newer.

```sh
npm install
npm run compile   # compile the contracts and generate TypeChain bindings
npm test          # run the Solidity tests in contracts/test/
npm run build     # compile and build the package into dist/
npm run node      # start a local Hardhat node
npm run clean     # remove build artifacts
```

The contracts compile with Solidity 0.8.34, optimizer on at 200 runs, targeting the Paris EVM.

## Deploying

The factory deploys with Hardhat Ignition, taking its admin and operator from `ignition/parameters/KiteFactory.json`:

```json
{
  "KiteFactoryModule": {
    "admin": "0x…",
    "operator": "0x…"
  }
}
```

The operator should be the address of the Kite server's operator wallet, which settles and refunds transfers. Then:

```sh
npm run deploy-factory           # to the local in-process network
npm run deploy-factory:mainnet   # to the network at FORK_URL
```

`deploy-factory:mainnet` deploys to whichever RPC `FORK_URL` points at, signing with `PRIVATE_KEY` and verifying on Etherscan with `ETHERSCAN_API_KEY`. Set them in a `.env` file or as Hardhat configuration variables.

## Project layout

```text
contracts/
  KiteFactory.sol    deploys, settles, refunds and recovers transfers
  Kite.sol           one transfer: settlement, fees, refunds
  interfaces/
  libraries/
  test/              Solidity tests (forge-std)
ignition/
  modules/           deployment and upgrade modules
  parameters/        admin and operator for each deployment
  deployments/       records of past deployments
typechain/           generated TypeScript bindings
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests and how releases work.

To report a vulnerability, follow [SECURITY.md](SECURITY.md) rather than opening an issue.

## License

[MIT](LICENSE)
