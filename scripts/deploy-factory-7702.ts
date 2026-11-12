/**
 *   npm run deploy-factory:7702
 *
 * Environment:
 *   PRIVATE_KEY             Your EOA. It is delegated to Alchemy's smart account and sends the calls.
 *   ALCHEMY_API_KEY         Alchemy API key
 *   ALCHEMY_GAS_POLICY_ID   Gas sponsorship policy covering this chain
 *   ADMIN                   DEFAULT_ADMIN_ROLE holder (defaults to your EOA)
 *   OPERATOR                OPERATOR_ROLE holder (defaults to the operator in
 *                           ignition/parameters/KiteFactory.json)
 *   PROXY_OWNER             Owner of the ProxyAdmin, i.e. who can upgrade (defaults to your EOA)
 *   SALT                    CREATE2 salt (defaults to 0x00…00). Keep it, and the addresses above,
 *                           the same on every chain to get the same factory address everywhere.
 *   VERIFY                  Set to "false" to skip verifying on the block explorer
 *
 * Once deployed, it verifies the contracts. Rerunning it with the same settings skips the deployment and only verifies.
 */
import {
  type Call,
  hasCode,
  loadSigner,
  optionalAddress,
  optionalEnv,
  sendSponsoredCalls,
} from "./lib/sponsored.js";
import {
  type Address,
  type Hex,
  getAddress,
  isHex,
  size,
  zeroHash,
} from "viem";
import { planFactoryDeployment } from "./lib/factory-deployment.js";
import { CONTRACTS, verifyAll } from "./lib/verify.js";
import { readFile } from "node:fs/promises";
import hre from "hardhat";
import { CREATE2_DEPLOYER } from "./lib/constants.js";

const ignitionOperator = async (): Promise<Address | undefined> => {
  const path = "../ignition/parameters/KiteFactory.json";
  const file = new URL(path, import.meta.url);
  const content = await readFile(file, "utf8");
  const params = JSON.parse(content);
  const operator = params?.KiteFactoryModule?.operator;
  return operator === undefined ? undefined : getAddress(operator);
};

const signer = loadSigner();
const salt = optionalEnv<Hex>("SALT") || zeroHash;
if (!isHex(salt) || size(salt) !== 32) {
  throw new Error("SALT must be 32 bytes of hex");
}

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
  salt,
});

console.log(`Network:        ${connection.networkName} (chain ${chain.id})`);
console.log(`Sender (EOA):   ${signer.address}`);
console.log(`Admin:          ${admin}`);
console.log(`Operator:       ${operator ?? "(not set)"}`);
console.log(`Proxy owner:    ${proxyOwner}`);
console.log(`Salt:           ${salt}`);
console.log(`Implementation: ${plan.implementation}`);
console.log(`Factory:        ${plan.factory}`);
console.log(`ProxyAdmin:     ${plan.proxyAdmin}\n`);

if (!(await hasCode(publicClient, CREATE2_DEPLOYER))) {
  throw new Error(
    `The CREATE2 deployer ${CREATE2_DEPLOYER} is not on chain ${chain.id}. ` +
      "See github.com/Arachnid/deterministic-deployment-proxy to deploy it first.",
  );
}

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

  const txHash = await sendSponsoredCalls(chain, calls);

  for (const address of [plan.implementation, plan.factory, plan.proxyAdmin]) {
    if (!(await hasCode(publicClient, address))) {
      throw new Error(`Nothing deployed at ${address} (tx ${txHash})`);
    }
  }

  console.log(`\nKiteFactory deployed at ${plan.factory} (tx ${txHash})`);
}

if (optionalEnv("VERIFY") === "false") {
  console.log("VERIFY=false, skipping verification.");
} else {
  const factory = await connection.viem.getContractAt(
    "KiteFactory",
    plan.factory,
  );

  const kiteImplementation = await factory.read.implementation();

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
