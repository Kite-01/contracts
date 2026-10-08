# Kite Contracts

Kite is a Solidity smart contract system for deploying and settling invoice-style payment flows using a factory and clone pattern. The repo contains the contract implementation, deployment module, generated typechain bindings, and a full Solidity test suite covering native token, ERC20, swaps, refunds, and recovery flows.

## What this repo contains

- `contracts/` — the Solidity source for the Kite factory, implementation, interfaces, and library helpers
- `contracts/test/` — Foundry-based contract tests for the protocol behavior
- `ignition/` — Hardhat Ignition deployment module and deployment parameters
- `typechain/` — generated TS bindings produced by the Hardhat typechain plugin
- `artifacts/` — compiled contract artifacts

## Core contracts

### `KiteFactory`

The factory deploys deterministic clone instances for each invoice transfer configuration. It exposes:

- `predictAddress(...)` for counterfactual address calculation
- `deploy(...)` for creating a clone under the operator role
- `settle(...)` to execute a payment flow
- `refund(...)` to refund funds after expiry or by operator authorization
- `recover(...)` to recover stray tokens after settlement

### `Kite`

Each deployed clone represents a single transfer invoice and tracks its status, settlement logic, fee distribution, and permissions. The implementation is designed to be locked down so callers cannot reinitialize or directly manipulate the deployment outside the factory.

## Protocol behavior

The contracts support:

- native ETH and ERC20 payment/in settlement
- same-token and cross-token settlement flows
- price routing through a configured Uniswap-style swap router
- custom fee splits with validation for maximum fee count and minimum output checks
- expiry-based refunds and post-settlement recovery
- deterministic deployment by transfer parameters
- overpayments and refunds that the refund address can't receive (e.g. a contract rejecting ETH) never block settlement or leave the transfer open: the amount stays in the clone for the operator to `recover`, and `Refunded` reports the amount actually sent
- `Recovered` reports the address the tokens were actually sent to

## Tech stack

- Hardhat 3
- Solidity 0.8.34
- OpenZeppelin contracts
- Uniswap swap-router interfaces
- viem + typechain generation
- Foundry-style test suite (`forge-std`)

## Prerequisites

- Node.js >= 22.13.0
- npm

## Installation

```bash
npm install
```

## Common commands

### Compile contracts

```bash
npm run compile
```

### Build project

```bash
npm run build
```

### Run the full test suite

```bash
npm test
```

This runs the Hardhat test command, which includes the Solidity tests under `contracts/test/`.

### Start a local Hardhat node

```bash
npm run node
```

### Clean build artifacts

```bash
npm run clean
```

## Deployment

The repo includes a Hardhat Ignition deployment for the factory:

```bash
npm run deploy-factory
```

This uses:

- `ignition/modules/KiteFactory.ts`
- `ignition/parameters/KiteFactory.json`

The default parameters file currently sets both `admin` and `operator` to the same address:

```json
{
  "KiteFactoryModule": {
    "admin": "0xA82474B1d4DDac1ed5e4ed047a4A3caD01C200C8",
    "operator": "0xA82474B1d4DDac1ed5e4ed047a4A3caD01C200C8"
  }
}
```

For a mainnet fork deployment, the project uses the `mainnet` network configuration from `hardhat.config.ts`:

```bash
npm run deploy-factory:mainnet
```

This expects the following environment variables to be available:

- `FORK_URL`
- `PRIVATE_KEY`
- `ETHERSCAN_API_KEY`

## Configuration notes

The configuration in `hardhat.config.ts` includes:

- Solidity compiler version `0.8.34`
- optimizer enabled with `runs: 200`
- `hardhat` and `hardhatOp` simulated network settings
- `mainnet` configured for an HTTP RPC with a configured private key
- Etherscan verification enabled via `ETHERSCAN_API_KEY`

## Repository structure

```text
.
├── contracts/
│   ├── interfaces/
│   ├── libraries/
│   ├── test/
│   ├── Kite.sol
│   └── KiteFactory.sol
├── ignition/
│   ├── modules/
│   └── parameters/
├── typechain/
├── artifacts/
├── hardhat.config.ts
├── package.json
├── tsconfig.json
├── README.md
└── .gitignore
```

## Notes

This repository is a contracts-focused project rather than a generic Hardhat starter. The implementation and scripts are shaped around the Kite payment factory and the invoice settlement lifecycle, rather than the default sample Counter deployment from a starter template.
