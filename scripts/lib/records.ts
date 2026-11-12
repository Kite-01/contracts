import { mkdir, readFile, writeFile } from "node:fs/promises";
import { type Address, type Hash } from "viem";

export interface DeploymentRecord {
  KiteFactoryProxy?: Address;
  KiteFactoryImplementation?: Address;
  ProxyAdmin?: Address;
  KiteImplementation?: Address;
  transactions?: {
    action: string;
    hash: Hash;
    at: string;
  }[];
}

const recordUrl = (chainId: number) => {
  return new URL(
    `../../deployments/7702/chain-${chainId}.json`,
    import.meta.url,
  );
};

export async function readRecord(chainId: number): Promise<DeploymentRecord> {
  try {
    return JSON.parse(await readFile(recordUrl(chainId), "utf8"));
  } catch {
    return {};
  }
}

export async function updateRecord(
  chainId: number,
  update: Omit<DeploymentRecord, "transactions">,
  transaction?: { action: string; hash: Hash | undefined },
) {
  const url = recordUrl(chainId);
  const record = {
    ...(await readRecord(chainId)),
    ...update,
  };

  if (transaction?.hash !== undefined) {
    record.transactions = [
      ...(record.transactions ?? []),
      {
        action: transaction.action,
        hash: transaction.hash,
        at: new Date().toISOString(),
      },
    ];
  }

  await mkdir(new URL(".", url), { recursive: true });
  await writeFile(url, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`Saved to deployments/7702/chain-${chainId}.json`);
}

export async function factoryAddress(
  chainId: number,
  fromEnv: Address | undefined,
): Promise<Address> {
  const address = fromEnv ?? (await readRecord(chainId)).KiteFactoryProxy;
  if (address === undefined) {
    throw new Error(
      `Set FACTORY to the KiteFactory proxy address (nothing recorded in deployments/7702/chain-${chainId}.json)`,
    );
  }

  return address;
}
