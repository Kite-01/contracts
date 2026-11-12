import {
  alchemyWalletTransport,
  createSmartWalletClient,
} from "@alchemy/wallet-apis";
import { type NetworkConnection } from "hardhat/types/network";
import {
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  createWalletClient,
  custom,
  getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface Call {
  to: Address;
  data: Hex;
}

export const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Set ${name}`);
  }

  return value;
};

export const optionalEnv = <T = string>(name: string): T | undefined => {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : (value as T);
};

export const optionalAddress = (name: string): Address | undefined => {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : getAddress(value);
};

export function loadSigner() {
  const key = required("PRIVATE_KEY");
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
}

export const hasCode = async (publicClient: PublicClient, address: Address) => {
  const code = await publicClient.getCode({
    address,
  });

  return code !== undefined && code !== "0x";
};

export async function sendSponsoredCalls(chain: Chain, calls: Call[]) {
  const client = createSmartWalletClient({
    signer: loadSigner(),
    transport: alchemyWalletTransport({
      apiKey: required("ALCHEMY_API_KEY"),
    }),
    chain,
    paymaster: {
      policyId: required("ALCHEMY_GAS_POLICY_ID"),
    },
  });

  console.log(`Sending ${calls.length} call(s) through Alchemy...`);

  const response = await client.sendCalls({ calls });
  const status = await client.waitForCallsStatus({
    id: response.id,
    timeout: 180_000,
  });

  const hash = status.receipts?.[0]?.transactionHash;
  if (status.status !== "success") {
    throw new Error(
      `Calls failed (status: ${status.status}, tx: ${hash ?? "n/a"})`,
    );
  }

  return hash;
}

export async function sendDirectCalls(
  connection: NetworkConnection,
  calls: Call[],
) {
  const publicClient = await connection.viem.getPublicClient();
  const walletClient = createWalletClient({
    account: loadSigner(),
    chain: publicClient.chain,
    transport: custom(connection.provider),
  });

  console.log(
    `Sending ${calls.length} transaction(s) from ${walletClient.account.address}, paying gas yourself...`,
  );

  let hash: Hex | undefined;
  for (const [index, call] of calls.entries()) {
    hash = await walletClient.sendTransaction(call);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 300_000,
    });

    if (receipt.status !== "success") {
      throw new Error(`Transaction ${index + 1} reverted (tx ${hash})`);
    }

    console.log(`  ${index + 1}/${calls.length}: ${hash}`);
  }

  return hash;
}

export async function sendCalls(connection: NetworkConnection, calls: Call[]) {
  if (optionalEnv("SPONSOR") === "false") {
    return sendDirectCalls(connection, calls);
  }

  const publicClient = await connection.viem.getPublicClient();
  return sendSponsoredCalls(publicClient.chain, calls);
}
