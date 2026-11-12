/**
 * Upgrades a KiteFactory proxy to the KiteFactory code in this repository
 * In one transaction it deploys the new implementation through the CREATE2 deployer (if it is not
 * there yet) and calls ProxyAdmin.upgradeAndCall. Your EOA must own the ProxyAdmin.
 *
 *   FACTORY=0x... npm run upgrade-factory:7702
 *
 * Environment:
 *   FACTORY                     The KiteFactory proxy address
 *   PRIVATE_KEY, ALCHEMY_API_KEY, ALCHEMY_GAS_POLICY_ID   As for deploy-factory-7702.ts
 *   SALT                        CREATE2 salt for the new implementation (defaults to 0x00…00)
 *   ALLOW_SAME_IMPLEMENTATION   Set to "true" to upgrade even if the proxy already runs this code
 *   VERIFY                      Set to "false" to skip verifying the new implementation
 */
import {
  type Address,
  type Hex,
  getAddress,
  isAddressEqual,
  isHex,
  size,
  zeroHash,
} from "viem";
import {
  type Call,
  hasCode,
  loadSigner,
  optionalAddress,
  optionalEnv,
  sendSponsoredCalls,
} from "./lib/sponsored.js";
import { ADMIN_SLOT, IMPLEMENTATION_SLOT } from "./lib/constants.js";
import { CONTRACTS, verifyAll } from "./lib/verify.js";
import { planFactoryUpgrade } from "./lib/factory-deployment.js";
import hre from "hardhat";

const factory = optionalAddress("FACTORY");
if (factory === undefined) {
  throw new Error("Set FACTORY to the KiteFactory proxy address");
}

const salt = optionalEnv("SALT") || zeroHash;
if (!isHex(salt) || size(salt) !== 32) {
  throw new Error("SALT must be 32 bytes of hex");
}

const signer = loadSigner();
const connection = await hre.network.create();

const { viem } = connection;
const publicClient = await viem.getPublicClient();
const chain = publicClient.chain;

const readSlotAddress = async (slot: Hex): Promise<Address> => {
  const value = await publicClient.getStorageAt({
    address: factory,
    slot,
  });

  return getAddress(`0x${(value ?? "0x").slice(-40).padStart(40, "0")}`);
};

const proxyAdminAddress = await readSlotAddress(ADMIN_SLOT);
const currentImplementation = await readSlotAddress(IMPLEMENTATION_SLOT);
const proxyAdmin = await viem.getContractAt("ProxyAdmin", proxyAdminAddress);
const owner = await proxyAdmin.read.owner();

const [kiteFactory, proxyAdminArtifact] = await Promise.all([
  hre.artifacts.readArtifact("KiteFactory"),
  hre.artifacts.readArtifact("ProxyAdmin"),
]);

const plan = planFactoryUpgrade({
  kiteFactory: {
    abi: kiteFactory.abi,
    bytecode: kiteFactory.bytecode,
  },
  proxyAdmin: {
    abi: proxyAdminArtifact.abi,
    bytecode: proxyAdminArtifact.bytecode,
  },
  factory,
  proxyAdminAddress,
  salt,
});

console.log(
  `Network:                ${connection.networkName} (chain ${chain.id})`,
);
console.log(`Sender (EOA):           ${signer.address}`);
console.log(`Factory:                ${factory}`);
console.log(`ProxyAdmin:             ${proxyAdminAddress} (owner: ${owner})`);
console.log(`Current implementation: ${currentImplementation}`);
console.log(`New implementation:     ${plan.implementation}\n`);

if (!isAddressEqual(owner, signer.address)) {
  throw new Error(
    `Your EOA ${signer.address} does not own the ProxyAdmin (owner is ${owner})`,
  );
}

if (
  isAddressEqual(currentImplementation, plan.implementation) &&
  optionalEnv("ALLOW_SAME_IMPLEMENTATION") !== "true"
) {
  console.log("The factory already runs this code, skipping the upgrade.");
  console.log("Set ALLOW_SAME_IMPLEMENTATION=true to send the upgrade anyway.");
} else {
  const calls: Call[] = [];

  if (await hasCode(publicClient, plan.implementation)) {
    console.log("New implementation already deployed, skipping it.");
  } else {
    calls.push(plan.implementationCall);
  }

  calls.push(plan.upgradeCall);

  const txHash = await sendSponsoredCalls(chain, calls);
  const implementationAfter = await readSlotAddress(IMPLEMENTATION_SLOT);
  if (!isAddressEqual(implementationAfter, plan.implementation)) {
    throw new Error(
      `Proxy points at ${implementationAfter}, expected ${plan.implementation} (tx ${txHash})`,
    );
  }

  console.log(
    `\nKiteFactory ${factory} now runs ${plan.implementation} (tx ${txHash})`,
  );
}

if (process.env.VERIFY === "false") {
  console.log("VERIFY=false, skipping verification.");
} else {
  console.log("\nVerifying...");
  await verifyAll(hre, chain.id, [
    {
      name: "KiteFactory implementation",
      address: plan.implementation,
      contract: CONTRACTS.KiteFactory,
    },
  ]);
}

process.exit(0);
