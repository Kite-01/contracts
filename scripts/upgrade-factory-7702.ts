import {
  type Call,
  hasCode,
  loadSigner,
  optionalAddress,
  optionalEnv,
  sendCalls,
} from "./lib/sponsored.js";
import { type Address, type Hex, getAddress, isAddressEqual } from "viem";
import { ADMIN_SLOT, IMPLEMENTATION_SLOT } from "./lib/constants.js";
import { factoryAddress, updateRecord } from "./lib/records.js";
import { assertCreateX, loadSalt } from "./lib/createx.js";
import { CONTRACTS, verifyAll } from "./lib/verify.js";
import { planFactoryUpgrade } from "./lib/factory-deployment.js";
import hre from "hardhat";

const salt = loadSalt();

const signer = loadSigner();
const connection = await hre.network.create();

const { viem } = connection;
const publicClient = await viem.getPublicClient();
const chain = publicClient.chain;
await assertCreateX(publicClient);
const factory = await factoryAddress(chain.id, optionalAddress("FACTORY"));

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
  sender: signer.address,
  chainId: chain.id,
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

  const txHash = await sendCalls(connection, calls);
  const implementationAfter = await readSlotAddress(IMPLEMENTATION_SLOT);
  if (!isAddressEqual(implementationAfter, plan.implementation)) {
    throw new Error(
      `Proxy points at ${implementationAfter}, expected ${plan.implementation} (tx ${txHash})`,
    );
  }

  console.log(
    `\nKiteFactory ${factory} now runs ${plan.implementation} (tx ${txHash})`,
  );

  await updateRecord(
    chain.id,
    {
      KiteFactoryProxy: factory,
      KiteFactoryImplementation: plan.implementation,
    },
    { action: "upgrade-factory", hash: txHash },
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
