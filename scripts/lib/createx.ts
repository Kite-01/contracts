import {
  type Address,
  type Hex,
  type PublicClient,
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getContractAddress,
  isAddressEqual,
  isHex,
  keccak256,
  numberToHex,
  pad,
  parseAbi,
  size,
  slice,
  zeroAddress,
  zeroHash,
} from "viem";
import { optionalEnv } from "./sponsored.js";
import { CREATE_X } from "./constants.js";

const createXAbi = parseAbi([
  "function deployCreate2(bytes32 salt, bytes initCode) payable returns (address)",
]);

export function guardSalt(salt: Hex, sender: Address, chainId: number): Hex {
  const senderBytes = slice(salt, 0, 20);
  const flag = slice(salt, 20, 21);
  const chain = numberToHex(chainId, { size: 32 });

  if (isAddressEqual(senderBytes, sender)) {
    if (flag === "0x01") {
      return keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "uint256" }, { type: "bytes32" }],
          [sender, BigInt(chainId), salt],
        ),
      );
    }

    if (flag === "0x00") {
      return keccak256(concat([pad(sender, { size: 32 }), salt]));
    }

    throw new Error("Invalid salt: byte 21 must be 0x00 or 0x01");
  }

  if (isAddressEqual(senderBytes, zeroAddress)) {
    if (flag === "0x01") return keccak256(concat([chain, salt]));
    if (flag !== "0x00") {
      throw new Error("Invalid salt: byte 21 must be 0x00 or 0x01");
    }
  }

  return keccak256(encodeAbiParameters([{ type: "bytes32" }], [salt]));
}

export function createXDeploy({
  initCode,
  salt,
  sender,
  chainId,
}: {
  initCode: Hex;
  salt: Hex;
  sender: Address;
  chainId: number;
}) {
  return {
    address: getContractAddress({
      opcode: "CREATE2",
      from: CREATE_X,
      salt: guardSalt(salt, sender, chainId),
      bytecode: initCode,
    }),
    call: {
      to: CREATE_X,
      data: encodeFunctionData({
        abi: createXAbi,
        functionName: "deployCreate2",
        args: [salt, initCode],
      }),
    },
  };
}

export function loadSalt(): Hex {
  const salt = optionalEnv("IGNITION_SALT") || zeroHash;
  if (!isHex(salt) || size(salt) !== 32) {
    throw new Error("IGNITION_SALT must be 32 bytes of hex");
  }

  return salt;
}

export async function assertCreateX(publicClient: PublicClient) {
  const code = await publicClient.getCode({ address: CREATE_X });
  if (code === undefined || code === "0x") {
    throw new Error(
      `CreateX (${CREATE_X}) is not on chain ${publicClient.chain?.id}. ` +
        "See github.com/pcaversaccio/createx#new-deployments to deploy it first.",
    );
  }
}
