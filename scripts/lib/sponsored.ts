import {
  alchemyWalletTransport,
  createSmartWalletClient,
} from "@alchemy/wallet-apis";
import {
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
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
