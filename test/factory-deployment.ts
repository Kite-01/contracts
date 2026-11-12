import {
  planFactoryDeployment,
  planFactoryUpgrade,
  planKiteUpgrade,
} from "../scripts/lib/factory-deployment.js";
import {
  CREATE2_DEPLOYER,
  CREATE2_DEPLOYER_CODE,
  IMPLEMENTATION_SLOT,
} from "../scripts/lib/constants.js";
import { getAddress, keccak256, toHex } from "viem";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";

describe("planFactoryDeployment", async () => {
  const { viem, networkHelpers } = await hre.network.create();

  const [sender, admin, operator, proxyOwner] = await viem.getWalletClients();
  const [kiteFactory, transparentUpgradeableProxy] = await Promise.all([
    hre.artifacts.readArtifact("KiteFactory"),
    hre.artifacts.readArtifact("TransparentUpgradeableProxy"),
  ]);

  const publicClient = await viem.getPublicClient();

  async function deployFixture() {
    await networkHelpers.setCode(CREATE2_DEPLOYER, CREATE2_DEPLOYER_CODE);

    const salt = keccak256(toHex("kite"));
    const plan = planFactoryDeployment({
      kiteFactory: {
        abi: kiteFactory.abi,
        bytecode: kiteFactory.bytecode,
      },
      transparentUpgradeableProxy: {
        abi: transparentUpgradeableProxy.abi,
        bytecode: transparentUpgradeableProxy.bytecode,
      },
      admin: admin.account.address,
      operator: operator.account.address,
      proxyOwner: proxyOwner.account.address,
      salt,
    });

    for (const call of [plan.implementationCall, plan.factoryCall]) {
      const hash = await sender.sendTransaction(call);
      await publicClient.waitForTransactionReceipt({
        hash,
      });
    }

    return plan;
  }

  it("deploys the implementation and proxy at the predicted addresses", async () => {
    const plan = await networkHelpers.loadFixture(deployFixture);

    for (const address of [
      plan.implementation,
      plan.factory,
      plan.proxyAdmin,
    ]) {
      const code = await publicClient.getCode({
        address,
      });

      assert.ok(code !== undefined && code !== "0x", `no code at ${address}`);
    }

    const implementationSlot = await publicClient.getStorageAt({
      address: plan.factory,
      slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
    });

    assert.equal(
      getAddress(`0x${implementationSlot!.slice(-40)}`),
      plan.implementation,
    );
  });

  it("initializes the factory with the given roles", async () => {
    const plan = await networkHelpers.loadFixture(deployFixture);
    const factory = await viem.getContractAt("KiteFactory", plan.factory);

    assert.equal(
      await factory.read.hasRole([
        await factory.read.DEFAULT_ADMIN_ROLE(),
        admin.account.address,
      ]),
      true,
    );

    assert.equal(
      await factory.read.hasRole([
        await factory.read.OPERATOR_ROLE(),
        operator.account.address,
      ]),
      true,
    );

    assert.equal(
      await factory.read.hasRole([
        await factory.read.DEFAULT_ADMIN_ROLE(),
        sender.account.address,
      ]),
      false,
    );

    const kite = await viem.getContractAt(
      "Kite",
      await factory.read.implementation(),
    );

    assert.equal(getAddress(await kite.read.factory()), plan.factory);
  });

  it("gives the ProxyAdmin to the proxy owner", async () => {
    const plan = await networkHelpers.loadFixture(deployFixture);
    const proxyAdmin = await viem.getContractAt("ProxyAdmin", plan.proxyAdmin);

    assert.equal(
      getAddress(await proxyAdmin.read.owner()),
      getAddress(proxyOwner.account.address),
    );

    const adminSlot = await publicClient.getStorageAt({
      address: plan.factory,
      slot: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
    });

    assert.equal(getAddress(`0x${adminSlot!.slice(-40)}`), plan.proxyAdmin);
  });

  describe("planFactoryUpgrade", () => {
    async function planUpgrade() {
      const plan = await networkHelpers.loadFixture(deployFixture);
      const proxyAdminArtifact = await hre.artifacts.readArtifact("ProxyAdmin");
      const upgrade = planFactoryUpgrade({
        kiteFactory: {
          abi: kiteFactory.abi,
          bytecode: kiteFactory.bytecode,
        },
        proxyAdmin: {
          abi: proxyAdminArtifact.abi,
          bytecode: proxyAdminArtifact.bytecode,
        },
        factory: plan.factory,
        proxyAdminAddress: plan.proxyAdmin,
        salt: keccak256(toHex("kite-v2")), // a different salt gives a second implementation to upgrade to
      });

      return { plan, upgrade };
    }

    it("points the proxy at the new implementation and keeps the state", async () => {
      const { plan, upgrade } = await planUpgrade();

      const factory = await viem.getContractAt("KiteFactory", plan.factory);
      const kiteImplementation = await factory.read.implementation();

      assert.notEqual(upgrade.implementation, plan.implementation);
      for (const call of [upgrade.implementationCall, upgrade.upgradeCall]) {
        const hash = await proxyOwner.sendTransaction(call);
        await publicClient.waitForTransactionReceipt({
          hash,
        });
      }

      const implementationSlot = await publicClient.getStorageAt({
        address: plan.factory,
        slot: IMPLEMENTATION_SLOT,
      });

      assert.equal(
        getAddress(`0x${implementationSlot!.slice(-40)}`),
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
      await sender.sendTransaction(upgrade.implementationCall);
      await assert.rejects(sender.sendTransaction(upgrade.upgradeCall));
    });
  });
});

describe("planKiteUpgrade", async () => {
  const { viem, networkHelpers } = await hre.network.create();
  const [sender, admin, operator] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  const [kite, kiteFactory, transparentUpgradeableProxy] = await Promise.all([
    hre.artifacts.readArtifact("Kite"),
    hre.artifacts.readArtifact("KiteFactory"),
    hre.artifacts.readArtifact("TransparentUpgradeableProxy"),
  ]);

  async function deployFixture() {
    await networkHelpers.setCode(CREATE2_DEPLOYER, CREATE2_DEPLOYER_CODE);

    const plan = planFactoryDeployment({
      kiteFactory: { abi: kiteFactory.abi, bytecode: kiteFactory.bytecode },
      transparentUpgradeableProxy: {
        abi: transparentUpgradeableProxy.abi,
        bytecode: transparentUpgradeableProxy.bytecode,
      },
      admin: admin.account.address,
      operator: operator.account.address,
      proxyOwner: admin.account.address,
    });

    for (const call of [plan.implementationCall, plan.factoryCall]) {
      await publicClient.waitForTransactionReceipt({
        hash: await sender.sendTransaction(call),
      });
    }

    const upgrade = planKiteUpgrade({
      kite: { abi: kite.abi, bytecode: kite.bytecode },
      kiteFactory: { abi: kiteFactory.abi, bytecode: kiteFactory.bytecode },
      factory: plan.factory,
    });

    return { plan, upgrade };
  }

  it("deploys the new Kite and points the factory at it", async () => {
    const { plan, upgrade } = await networkHelpers.loadFixture(deployFixture);
    const factory = await viem.getContractAt("KiteFactory", plan.factory);
    const previous = await factory.read.implementation();

    for (const call of [upgrade.implementationCall, upgrade.setImplementationCall]) {
      await publicClient.waitForTransactionReceipt({
        hash: await admin.sendTransaction(call),
      });
    }

    assert.equal(await factory.read.implementation(), upgrade.implementation);
    assert.equal(await factory.read.isImplementation([previous]), true);

    const newKite = await viem.getContractAt("Kite", upgrade.implementation);
    assert.equal(getAddress(await newKite.read.factory()), plan.factory);

    // Same code as the Kite the factory deployed itself
    const { data: newCode } = await publicClient.call({ data: upgrade.initCode });
    assert.equal(newCode, await publicClient.getCode({ address: previous }));
  });

  it("rejects setImplementation from anyone but the admin", async () => {
    const { upgrade } = await networkHelpers.loadFixture(deployFixture);
    await sender.sendTransaction(upgrade.implementationCall);
    await assert.rejects(sender.sendTransaction(upgrade.setImplementationCall));
  });
});
