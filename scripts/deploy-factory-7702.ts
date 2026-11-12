import {
  type Call,
  hasCode,
  loadSigner,
  optionalAddress,
  optionalEnv,
  sendCalls,
} from "./lib/sponsored.js";
import { type Address, getAddress } from "viem";
import { assertCreateX, loadSalt } from "./lib/createx.js";
import { planFactoryDeployment } from "./lib/factory-deployment.js";
import { CONTRACTS, verifyAll } from "./lib/verify.js";
import { updateRecord } from "./lib/records.js";
import { readFile } from "node:fs/promises";
import hre from "hardhat";

const ignitionOperator = async (): Promise<Address | undefined> => {
  const path = "../ignition/parameters/KiteFactory.json";
  const file = new URL(path, import.meta.url);
  const content = await readFile(file, "utf8");
  const params = JSON.parse(content);
  const operator = params?.KiteFactoryModule?.operator;
  return operator === undefined ? undefined : getAddress(operator);
};

const signer = loadSigner();
const salt = loadSalt();

const admin = optionalAddress("ADMIN") ?? signer.address;
const proxyOwner = optionalAddress("PROXY_OWNER") ?? signer.address;
let operator = optionalAddress("OPERATOR");

if (!operator) {
  operator = await ignitionOperator();
  if (!operator) {
    throw new Error("OPERATOR address not set");
  }
}

const connection = await hre.network.create();
const publicClient = await connection.viem.getPublicClient();
const chain = publicClient.chain;

const [kiteFactory, transparentUpgradeableProxy] = await Promise.all([
  hre.artifacts.readArtifact("KiteFactory"),
  hre.artifacts.readArtifact("TransparentUpgradeableProxy"),
]);

const plan = planFactoryDeployment({
  kiteFactory: {
    abi: kiteFactory.abi,
    bytecode: kiteFactory.bytecode,
  },
  transparentUpgradeableProxy: {
    abi: transparentUpgradeableProxy.abi,
    bytecode: transparentUpgradeableProxy.bytecode,
  },
  admin,
  operator,
  proxyOwner,
  sender: signer.address,
  chainId: chain.id,
  salt,
});

console.log(`Network:        ${connection.networkName} (chain ${chain.id})`);
console.log(`Sender (EOA):   ${signer.address}`);
console.log(`Admin:          ${admin}`);
console.log(`Operator:       ${operator ?? "(not set)"}`);
console.log(`Proxy owner:    ${proxyOwner}`);
console.log(`Salt:           ${salt}`);
console.log(`Implementation: ${plan.implementation}`);
console.log(`Factory Proxy:        ${plan.factory}`);
console.log(`ProxyAdmin:     ${plan.proxyAdmin}\n`);

await assertCreateX(publicClient);

let txHash;
if (await hasCode(publicClient, plan.factory)) {
  console.log("Factory already deployed, skipping to verification.");
} else {
  const calls: Call[] = [];

  if (await hasCode(publicClient, plan.implementation)) {
    console.log("Implementation already deployed, skipping it.");
  } else {
    calls.push(plan.implementationCall);
  }

  calls.push(plan.factoryCall);

  txHash = await sendCalls(connection, calls);

  for (const address of [plan.implementation, plan.factory, plan.proxyAdmin]) {
    if (!(await hasCode(publicClient, address))) {
      throw new Error(`Nothing deployed at ${address} (tx ${txHash})`);
    }
  }

  console.log(`\nKiteFactory deployed at ${plan.factory} (tx ${txHash})`);
}

const factory = await connection.viem.getContractAt(
  "KiteFactory",
  plan.factory,
);

const kiteImplementation = await factory.read.implementation();

await updateRecord(
  chain.id,
  {
    KiteFactoryProxy: plan.factory,
    KiteFactoryImplementation: plan.implementation,
    ProxyAdmin: plan.proxyAdmin,
    KiteImplementation: kiteImplementation,
  },
  { action: "deploy-factory", hash: txHash },
);

if (optionalEnv("VERIFY") === "false") {
  console.log("VERIFY=false, skipping verification.");
} else {
  console.log("\nVerifying...");

  await verifyAll(hre, chain.id, [
    {
      name: "KiteFactory implementation",
      address: plan.implementation,
      contract: CONTRACTS.KiteFactory,
    },
    {
      name: "KiteFactory proxy",
      address: plan.factory,
      contract: CONTRACTS.TransparentUpgradeableProxy,
      constructorArgs: [...plan.proxyConstructorArgs],
    },
    {
      name: "ProxyAdmin",
      address: plan.proxyAdmin,
      contract: CONTRACTS.ProxyAdmin,
      constructorArgs: [proxyOwner],
    },
    {
      name: "Kite implementation",
      address: kiteImplementation,
      contract: CONTRACTS.Kite,
      constructorArgs: [plan.factory],
    },
  ]);
}

process.exit(0);
