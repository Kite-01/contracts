import {
  planFactoryDeployment,
  planFactoryUpgrade,
  planKiteUpgrade,
} from "../scripts/lib/factory-deployment.js";
import {
  ADMIN_SLOT,
  CREATE_X,
  IMPLEMENTATION_SLOT,
} from "../scripts/lib/constants.js";
import {
  type Address,
  type Hex,
  concat,
  getAddress,
  keccak256,
  pad,
  toHex,
  zeroAddress,
  zeroHash,
} from "viem";
import KiteImplementationModule from "../ignition/modules/upgrades/KiteImplementation.js";
import KiteFactoryUpgradeModule from "../ignition/modules/upgrades/KiteFactory.js";
import KiteFactoryModule from "../ignition/modules/KiteFactory.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";

const [kite, kiteFactory, transparentUpgradeableProxy, proxyAdminArtifact] =
  await Promise.all([
    hre.artifacts.readArtifact("Kite"),
    hre.artifacts.readArtifact("KiteFactory"),
    hre.artifacts.readArtifact("TransparentUpgradeableProxy"),
    hre.artifacts.readArtifact("ProxyAdmin"),
  ]);

const artifacts = {
  kite: { abi: kite.abi, bytecode: kite.bytecode },
  kiteFactory: { abi: kiteFactory.abi, bytecode: kiteFactory.bytecode },
  transparentUpgradeableProxy: {
    abi: transparentUpgradeableProxy.abi,
    bytecode: transparentUpgradeableProxy.bytecode,
  },
  proxyAdmin: {
    abi: proxyAdminArtifact.abi,
    bytecode: proxyAdminArtifact.bytecode,
  },
};

const CHAIN_ID = 31337;

const slotAddress = (value: Hex | undefined) =>
  getAddress(`0x${value!.slice(-40)}`);

async function ignitionDeploy(salt: Hex) {
  const connection = await hre.network.create();
  const [deployer, , operator] = await connection.viem.getWalletClients();
  const deployed = await connection.ignition.deploy(KiteFactoryModule, {
    strategy: "create2",
    strategyConfig: {
      salt,
    },
    parameters: {
      KiteFactoryModule: {
        operator: operator.account.address,
      },
    },
    displayUi: false,
  });

  return {
    connection,
    deployed,
    deployer: deployer.account.address,
    operator: operator.account.address,
  };
}

describe("7702 plans land where Ignition's create2 strategy deploys", async () => {
  const sender = (await (await hre.network.create()).viem.getWalletClients())[0]
    .account.address;

  // CreateX derives the salt it uses from the first 21 bytes, so cover each kind
  const salts: Record<string, Hex> = {
    "zero salt": zeroHash,
    "plain salt": keccak256(toHex("kite")),
    "salt reserved for the sender": concat([
      sender,
      "0x00",
      pad("0x01", { size: 11 }),
    ]),
    "salt bound to the sender and chain": concat([
      sender,
      "0x01",
      pad("0x02", { size: 11 }),
    ]),
    "salt bound to the chain": concat([
      zeroAddress,
      "0x01",
      pad("0x03", { size: 11 }),
    ]),
  };

  for (const [label, salt] of Object.entries(salts)) {
    it(`deploys to the same addresses with a ${label}`, async () => {
      const { connection, deployed, deployer, operator } = await ignitionDeploy(
        salt,
      );

      const plan = planFactoryDeployment({
        ...artifacts,
        admin: deployer,
        operator,
        proxyOwner: deployer,
        sender: deployer,
        chainId: CHAIN_ID,
        salt,
      });

      const publicClient = await connection.viem.getPublicClient();
      assert.equal(plan.factory, getAddress(deployed.KiteFactoryProxy.address));
      assert.equal(plan.proxyAdmin, getAddress(deployed.ProxyAdmin.address));
      assert.equal(
        plan.implementation,
        slotAddress(
          await publicClient.getStorageAt({
            address: plan.factory,
            slot: IMPLEMENTATION_SLOT,
          }),
        ),
      );
    });
  }

  it("upgrades to the same addresses as the Ignition upgrade modules", async () => {
    const salt = keccak256(toHex("kite"));
    const upgradeSalt = keccak256(toHex("kite-v2"));
    const { connection, deployed, deployer } = await ignitionDeploy(salt);
    const factory = getAddress(deployed.KiteFactoryProxy.address);

    await connection.ignition.deploy(KiteFactoryUpgradeModule, {
      strategy: "create2",
      strategyConfig: { salt: upgradeSalt },
      parameters: {
        KiteFactoryUpgradeModule: {
          proxyAdmin: deployed.ProxyAdmin.address,
          factory,
        },
      },
      displayUi: false,
    });

    const { Kite } = await connection.ignition.deploy(
      KiteImplementationModule,
      {
        strategy: "create2",
        strategyConfig: { salt },
        parameters: { KiteImplementationModule: { factory } },
        displayUi: false,
      },
    );

    const publicClient = await connection.viem.getPublicClient();
    const factoryUpgrade = planFactoryUpgrade({
      ...artifacts,
      factory,
      proxyAdminAddress: getAddress(deployed.ProxyAdmin.address),
      sender: deployer,
      chainId: CHAIN_ID,
      salt: upgradeSalt,
    });

    assert.equal(
      factoryUpgrade.implementation,
      slotAddress(
        await publicClient.getStorageAt({
          address: factory,
          slot: IMPLEMENTATION_SLOT,
        }),
      ),
    );

    const kiteUpgrade = planKiteUpgrade({
      ...artifacts,
      factory,
      sender: deployer,
      chainId: CHAIN_ID,
      salt,
    });

    assert.equal(kiteUpgrade.implementation, getAddress(Kite.address));
  });
});

describe("Sending the planned calls", async () => {
  // Ignition puts CreateX on a local network; copy its code into this one
  const createXCode = await (async () => {
    const { connection } = await ignitionDeploy(zeroHash);
    const publicClient = await connection.viem.getPublicClient();
    return (await publicClient.getCode({ address: CREATE_X }))!;
  })();

  const { viem, networkHelpers } = await hre.network.create();
  const [sender, admin, operator, proxyOwner] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const salt = keccak256(toHex("kite-direct"));

  const send = async (
    from: typeof sender,
    calls: { to: Address; data: Hex }[],
  ) => {
    for (const call of calls) {
      await publicClient.waitForTransactionReceipt({
        hash: await from.sendTransaction(call),
      });
    }
  };

  async function deployFixture() {
    await networkHelpers.setCode(CREATE_X, createXCode);

    const plan = planFactoryDeployment({
      ...artifacts,
      admin: admin.account.address,
      operator: operator.account.address,
      proxyOwner: proxyOwner.account.address,
      sender: sender.account.address,
      chainId: CHAIN_ID,
      salt,
    });

    await send(sender, [plan.implementationCall, plan.factoryCall]);
    return plan;
  }

  it("deploys the factory with the given roles and ProxyAdmin owner", async () => {
    const plan = await networkHelpers.loadFixture(deployFixture);
    const factory = await viem.getContractAt("KiteFactory", plan.factory);

    const adminRole = await factory.read.DEFAULT_ADMIN_ROLE();
    assert.equal(
      await factory.read.hasRole([adminRole, admin.account.address]),
      true,
    );
    assert.equal(
      await factory.read.hasRole([adminRole, sender.account.address]),
      false,
    );
    assert.equal(
      await factory.read.hasRole([
        await factory.read.OPERATOR_ROLE(),
        operator.account.address,
      ]),
      true,
    );

    const proxyAdmin = await viem.getContractAt("ProxyAdmin", plan.proxyAdmin);
    assert.equal(
      getAddress(await proxyAdmin.read.owner()),
      getAddress(proxyOwner.account.address),
    );
    assert.equal(
      slotAddress(
        await publicClient.getStorageAt({
          address: plan.factory,
          slot: ADMIN_SLOT,
        }),
      ),
      plan.proxyAdmin,
    );

    const kiteImplementation = await viem.getContractAt(
      "Kite",
      await factory.read.implementation(),
    );
    assert.equal(
      getAddress(await kiteImplementation.read.factory()),
      plan.factory,
    );
  });

  describe("planFactoryUpgrade", () => {
    async function planUpgrade() {
      const plan = await networkHelpers.loadFixture(deployFixture);
      const upgrade = planFactoryUpgrade({
        ...artifacts,
        factory: plan.factory,
        proxyAdminAddress: plan.proxyAdmin,
        sender: proxyOwner.account.address,
        chainId: CHAIN_ID,
        salt: keccak256(toHex("kite-direct-v2")), // same code, so a new salt for a new address
      });

      return { plan, upgrade };
    }

    it("points the proxy at the new implementation and keeps the state", async () => {
      const { plan, upgrade } = await planUpgrade();
      const factory = await viem.getContractAt("KiteFactory", plan.factory);
      const kiteImplementation = await factory.read.implementation();

      assert.notEqual(upgrade.implementation, plan.implementation);
      await send(proxyOwner, [upgrade.implementationCall, upgrade.upgradeCall]);

      assert.equal(
        slotAddress(
          await publicClient.getStorageAt({
            address: plan.factory,
            slot: IMPLEMENTATION_SLOT,
          }),
        ),
        upgrade.implementation,
      );
      assert.equal(await factory.read.implementation(), kiteImplementation);
      assert.equal(
        await factory.read.hasRole([
          await factory.read.OPERATOR_ROLE(),
          operator.account.address,
        ]),
        true,
      );
    });

    it("rejects the upgrade from anyone but the proxy owner", async () => {
      const { upgrade } = await planUpgrade();
      await send(sender, [upgrade.implementationCall]);
      await assert.rejects(sender.sendTransaction(upgrade.upgradeCall));
    });
  });

  describe("planKiteUpgrade", () => {
    async function planUpgrade() {
      const plan = await networkHelpers.loadFixture(deployFixture);
      const upgrade = planKiteUpgrade({
        ...artifacts,
        factory: plan.factory,
        sender: admin.account.address,
        chainId: CHAIN_ID,
        salt,
      });

      return { plan, upgrade };
    }

    it("deploys the new Kite and points the factory at it", async () => {
      const { plan, upgrade } = await planUpgrade();
      const factory = await viem.getContractAt("KiteFactory", plan.factory);
      const previous = await factory.read.implementation();

      await send(admin, [
        upgrade.implementationCall,
        upgrade.setImplementationCall,
      ]);

      assert.equal(await factory.read.implementation(), upgrade.implementation);
      assert.equal(await factory.read.isImplementation([previous]), true);

      // Same code as the Kite the factory deployed itself
      const { data: newCode } = await publicClient.call({
        data: upgrade.initCode,
      });
      assert.equal(newCode, await publicClient.getCode({ address: previous }));
    });

    it("rejects setImplementation from anyone but the admin", async () => {
      const { upgrade } = await planUpgrade();
      await send(sender, [upgrade.implementationCall]);
      await assert.rejects(
        sender.sendTransaction(upgrade.setImplementationCall),
      );
    });
  });
});
