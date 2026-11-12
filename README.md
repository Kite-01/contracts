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

[`ignition/deployments/`](ignition/deployments) records our own deployments, in a `chain-<chain id>` folder each. They're operated by our servers, so they won't work with yours: a Kite server only settles through a factory where its operator wallet holds the operator role. [Deploy your own](#deploying).

## Development

You need Node.js 22.13 or newer.

```sh
npm install

# compile the contracts and generate TypeChain bindings
npm run compile

# run the Solidity tests in contracts/test/ and the TypeScript tests in test/
npm test

# compile and build the package into dist/
npm run build

# start a local Hardhat node
npm run node

# remove build artifacts
npm run clean
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

The operator must be your Kite server's operator wallet, which settles and refunds transfers: the first account of its `KITE_OPERATOR_MNEMONIC` ([how to print its address](https://github.com/Kite-01/server#getting-started)). The server refuses a factory where that wallet isn't an operator.

Copy [`.env.example`](.env.example) to `.env` and fill it in. Every `:mainnet` and `:7702` script runs against the `mainnet` network, which is whichever RPC `FORK_URL` points at, so to deploy on another chain you only change `FORK_URL` (and `ETHERSCAN_API_KEY` if needed). You can also set these as Hardhat configuration variables.

```sh
# to the local in-process network
npm run deploy-factory

# to the chain at FORK_URL, through CreateX, verifying afterwards
npm run deploy-factory:mainnet
```

`deploy-factory:mainnet` signs with `PRIVATE_KEY` and deploys through [CreateX](https://github.com/pcaversaccio/createx) (Ignition's `create2` strategy), so the same salt, deployer and parameters give the same addresses on every chain. The salt is `IGNITION_SALT`, or `0x00…00` when it isn't set. It then verifies on Etherscan (`ETHERSCAN_API_KEY`), Blockscout and Sourcify.

Ignition files a deployment under `ignition/deployments/chain-<chain id>/` unless you name it. On a chain where we've deployed, that folder already holds our records, so give yours a name:

```sh
npm run deploy-factory:mainnet -- --deployment-id my-kite-base
```

Configure your Kite server with `KiteFactoryModule#KiteFactoryProxy` from that deployment's `deployed_addresses.json`. It's the factory's address, and upgrades don't change it.

To upgrade with Ignition, as the `ProxyAdmin` owner (factory code) or the admin (`Kite` code), pass the addresses in a parameters file:

```sh
# { "KiteFactoryUpgradeModule": { "proxyAdmin": "0x…", "factory": "0x…" } }
npm run upgrade-factory:mainnet -- --parameters upgrade.json

# { "KiteImplementationModule": { "factory": "0x…" } }
npm run upgrade-kite:mainnet -- --parameters kite.json
```

Both verify what they deploy. They use Ignition's default strategy; add `--strategy create2` to go through CreateX, but then deploying the same code with the same salt twice fails, so only upgrade once the code has changed, or set a new `IGNITION_SALT`.

### Deploying without gas (EIP-7702 + Alchemy)

Your EOA can deploy and upgrade without holding any ETH: it's delegated to Alchemy's smart account with EIP-7702, and an Alchemy gas policy pays. Everything goes through the CREATE2 deployer at `0x4e59b44847b379578588920cA78FbF26c0B4956C`, so the same settings give the same factory address on every chain. That's a different deployer from CreateX, so these addresses differ from `deploy-factory:mainnet`'s: pick one way per factory.

Set `FORK_URL`, `PRIVATE_KEY`, `ALCHEMY_API_KEY` and `ALCHEMY_GAS_POLICY_ID` (a policy covering the chain, with EIP-7702 enabled). Admin and proxy owner default to your EOA and the operator to `ignition/parameters/KiteFactory.json`; override them with `ADMIN`, `OPERATOR`, `PROXY_OWNER` and `SALT`, and keep them identical across chains to keep the address.

```sh
npm run deploy-factory:7702

# deploys the current KiteFactory code and upgrades the proxy to it; your EOA must own the ProxyAdmin
FACTORY=0x… npm run upgrade-factory:7702

# deploys the current Kite code and calls setImplementation; your EOA must be the factory's admin
FACTORY=0x… npm run upgrade-kite:7702
```

The upgrades skip themselves when the code hasn't changed; set `ALLOW_SAME_IMPLEMENTATION=true` to send them anyway. A new `Kite` only applies to transfers created afterwards (see [Upgrades](#upgrades)).

All three verify what they deployed once they're done, on Etherscan (skipped on chains your plan doesn't cover; the free plan excludes Base), Blockscout and Sourcify. Set `VERIFY=false` to skip it. Rerunning `deploy-factory:7702` with the same settings only verifies.

## Project layout

```text
contracts/
  KiteFactory.sol    deploys, settles, refunds and recovers transfers
  Kite.sol           one transfer: settlement, fees, refunds
  interfaces/
  libraries/
  test/              Solidity tests (forge-std)
scripts/             gasless (EIP-7702) deploy and upgrade scripts
test/                TypeScript tests for the scripts and Ignition modules
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
