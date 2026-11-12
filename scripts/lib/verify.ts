import { type HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import { type Address } from "viem";

export const CONTRACTS = {
  Kite: "contracts/Kite.sol:Kite",
  KiteFactory: "contracts/KiteFactory.sol:KiteFactory",
  ProxyAdmin:
    "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol:ProxyAdmin",
  TransparentUpgradeableProxy:
    "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy",
} as const;

export interface ContractToVerify {
  name: string;
  address: Address;
  contract: string;
  constructorArgs?: unknown[];
}

type Provider = "etherscan" | "blockscout" | "sourcify";

const sleep = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const withTimeout = <T>(promise: Promise<T>, ms: number) => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`no result after ${ms / 1000}s`)),
        ms,
      ).unref(),
    ),
  ]);
};

async function etherscanCovers(
  hre: HardhatRuntimeEnvironment,
  chainId: number,
) {
  const apiKey = await hre.config.verify.etherscan.apiKey.get();
  const url = new URL("https://api.etherscan.io/v2/api");
  url.search = new URLSearchParams({
    chainid: String(chainId),
    module: "block",
    action: "getblocknobytime",
    timestamp: String(Math.floor(Date.now() / 1000) - 60),
    closest: "before",
    apikey: apiKey,
  }).toString();

  try {
    const body = (await (await fetch(url)).json()) as {
      status: string;
      result: unknown;
    };

    if (body.status === "1") {
      return true;
    }

    console.log(`Skipping Etherscan: ${String(body.result)}`);
    return false;
  } catch (error) {
    console.log(
      `Skipping Etherscan: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    return false;
  }
}

async function enabledProviders(
  hre: HardhatRuntimeEnvironment,
  chainId: number,
) {
  const providers: Provider[] = [];

  if (hre.config.verify.etherscan.enabled) {
    if (await etherscanCovers(hre, chainId)) {
      providers.push("etherscan");
    }
  }

  if (hre.config.verify.blockscout.enabled) providers.push("blockscout");
  if (hre.config.verify.sourcify.enabled) providers.push("sourcify");
  return providers;
}

export async function verifyAll(
  hre: HardhatRuntimeEnvironment,
  chainId: number,
  contracts: ContractToVerify[],
  { attempts = 4, delayMs = 10_000, timeoutMs = 120_000 } = {},
) {
  const providers = await enabledProviders(hre, chainId);
  let allVerified = true;

  for (const provider of providers) {
    for (const { name, address, contract, constructorArgs = [] } of contracts) {
      for (let attempt = 1; ; attempt++) {
        try {
          await withTimeout(
            verifyContract(
              {
                address,
                contract,
                constructorArgs,
                provider,
              },
              hre,
            ),
            timeoutMs,
          );

          console.log(`[${provider}] Verified ${name} at ${address}`);
          break;
        } catch (error) {
          const message = (
            error instanceof Error ? error.message : String(error)
          ).split("\n")[0];

          const refused = /status code 40[13]|not supported/i.test(message);
          if (refused || attempt >= attempts) {
            console.error(
              `[${provider}] Could not verify ${name} at ${address}: ${message}`,
            );

            allVerified = false;
            break;
          }

          console.log(
            `[${provider}] ${name}: attempt ${attempt}/${attempts} failed (${message}), retrying`,
          );

          await sleep(delayMs);
        }
      }
    }
  }

  return allVerified;
}
