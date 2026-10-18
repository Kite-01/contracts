# Contributing

Thanks for helping with Kite. This repo holds the on-chain half: the contracts that receive, swap, settle and refund each payment. Because they hold funds, changes here get more scrutiny than elsewhere, and tests are not optional.

Found a security issue? Don't open an issue or pull request; follow [SECURITY.md](SECURITY.md).

## Before you start

For anything beyond a small fix, open an issue first and describe the change. Contract changes affect every server that deploys them, so it's worth agreeing on the approach before you write it.

## Setup

You need Node.js 22.13 or newer.

```sh
npm install
npm run compile
npm test
```

## Making a change

1. Fork the repo and branch from `main`.
2. Make the change, with tests in `contracts/test/` that fail without it. Cover the paths that move funds: native and ERC-20, swaps, fees, refunds and recovery.
3. Keep the public interface stable where you can. If a change breaks the ABI, events or deployed behaviour, say so in the pull request: the server depends on them through `@kite-01/contracts`.
4. Run `npm test` and `npm run build`; both must pass.
5. Add a changeset (below).
6. Open a pull request saying what changed and why. Link the issue if there is one.

Write comments only where the code can't explain itself, such as an invariant or why a check is ordered the way it is.

## Changesets

Every change that affects the published package needs a changeset:

```sh
npx changeset
```

Pick `patch` for fixes, `minor` for new features and `major` for anything that breaks the ABI or behaviour, then write one line a user of the package would understand. Commit the file it creates in `.changeset/` with your change. Changes that don't touch the package, like CI or docs, don't need one.

## Releases

Maintainers release; you don't need to do anything beyond the changeset.

When changesets reach `main`, the **Version** workflow opens a "Version packages" pull request that bumps the version and writes `CHANGELOG.md`. Merging it, then running the **Release** workflow, publishes to npm.

## License

By contributing, you agree your contributions are licensed under the [MIT License](LICENSE).
