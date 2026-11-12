/**
 * Ships the Kite code in this repository to a KiteFactory.
 * In one transaction it deploys the new Kite implementation through the CREATE2 deployer (if it is
 * not there yet) and calls KiteFactory.setImplementation. Your EOA must hold DEFAULT_ADMIN_ROLE.
 * Only transfers created afterwards use the new code.
 *
 *   npm run upgrade-kite:7702
 *
 * Environment:
 *   FACTORY                     The KiteFactory proxy address (defaults to KiteFactoryProxy in
 *                               deployments/7702/chain-<chain id>.json)
 *   PRIVATE_KEY, ALCHEMY_API_KEY, ALCHEMY_GAS_POLICY_ID   As for deploy-factory-7702.ts
 *   SALT                        CREATE2 salt for the new implementation (defaults to 0x00…00)
 *   ALLOW_SAME_IMPLEMENTATION   Set to "true" to upgrade even if the factory already runs this code
 *   VERIFY                      Set to "false" to skip verifying the new implementation
 */
import { isAddressEqual, isHex, size, zeroHash } from "viem";
import {
  type Call,
  hasCode,
  loadSigner,
  optionalAddress,
  optionalEnv,
  sendSponsoredCalls,
} from "./lib/sponsored.js";
import { CONTRACTS, verifyAll } from "./lib/verify.js";
import { planKiteUpgrade } from "./lib/factory-deployment.js";
import { factoryAddress as resolveFactory, updateRecord } from "./lib/records.js";
import hre from "hardhat";

const salt = optionalEnv("SALT") || zeroHash;
if (!isHex(salt) || size(salt) !== 32) {
  throw new Error("SALT must be 32 bytes of hex");
}

const signer = loadSigner();
const connection = await hre.network.create();

const { viem } = connection;
const publicClient = await viem.getPublicClient();
const chain = publicClient.chain;
const factoryAddress = await resolveFactory(
  chain.id,
  optionalAddress("FACTORY"),
);

const factory = await viem.getContractAt("KiteFactory", factoryAddress);
const currentImplementation = await factory.read.implementation();

const [kite, kiteFactory] = await Promise.all([
  hre.artifacts.readArtifact("Kite"),
  hre.artifacts.readArtifact("KiteFactory"),
]);

const plan = planKiteUpgrade({
  kite: { abi: kite.abi, bytecode: kite.bytecode },
  kiteFactory: { abi: kiteFactory.abi, bytecode: kiteFactory.bytecode },
  factory: factoryAddress,
  salt,
});

console.log(
  `Network:                ${connection.networkName} (chain ${chain.id})`,
);
console.log(`Sender (EOA):           ${signer.address}`);
console.log(`Factory:                ${factoryAddress}`);
console.log(`Current implementation: ${currentImplementation}`);
console.log(`New implementation:     ${plan.implementation}\n`);

const isAdmin = await factory.read.hasRole([
  await factory.read.DEFAULT_ADMIN_ROLE(),
  signer.address,
]);

if (!isAdmin) {
  throw new Error(
    `Your EOA ${signer.address} does not have DEFAULT_ADMIN_ROLE on the factory`,
  );
}

// The runtime code the new implementation would have, to compare with the current one
const { data: newCode } = await publicClient.call({ data: plan.initCode });
const currentCode = await publicClient.getCode({
  address: currentImplementation,
});

const unchanged =
  isAddressEqual(currentImplementation, plan.implementation) ||
  (newCode !== undefined && newCode === currentCode);

if (unchanged && optionalEnv("ALLOW_SAME_IMPLEMENTATION") !== "true") {
  console.log("The factory already runs this Kite code, skipping the upgrade.");
  console.log("Set ALLOW_SAME_IMPLEMENTATION=true to send the upgrade anyway.");
} else {
  const calls: Call[] = [];

  if (await hasCode(publicClient, plan.implementation)) {
    console.log("New implementation already deployed, skipping it.");
  } else {
    calls.push(plan.implementationCall);
  }

  calls.push(plan.setImplementationCall);

  const txHash = await sendSponsoredCalls(chain, calls);
  const implementationAfter = await factory.read.implementation();
  if (!isAddressEqual(implementationAfter, plan.implementation)) {
    throw new Error(
      `Factory uses ${implementationAfter}, expected ${plan.implementation} (tx ${txHash})`,
    );
  }

  console.log(
    `\nKiteFactory ${factoryAddress} now uses Kite ${plan.implementation} (tx ${txHash})`,
  );

  await updateRecord(
    chain.id,
    { KiteFactoryProxy: factoryAddress, KiteImplementation: plan.implementation },
    { action: "upgrade-kite", hash: txHash },
  );
}

if (optionalEnv("VERIFY") === "false") {
  console.log("VERIFY=false, skipping verification.");
} else {
  const toVerify = unchanged ? currentImplementation : plan.implementation;

  console.log("\nVerifying...");
  await verifyAll(hre, chain.id, [
    {
      name: "Kite implementation",
      address: toVerify,
      contract: CONTRACTS.Kite,
      constructorArgs: [factoryAddress],
    },
  ]);
}

process.exit(0);
