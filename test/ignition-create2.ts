import { getAddress, keccak256, toHex } from "viem";
import { IMPLEMENTATION_SLOT } from "../scripts/lib/constants.js";
import { describe, it } from "node:test";
import KiteImplementationModule from "../ignition/modules/upgrades/KiteImplementation.js";
import KiteFactoryUpgradeModule from "../ignition/modules/upgrades/KiteFactory.js";
import KiteFactoryModule from "../ignition/modules/KiteFactory.js";
import assert from "node:assert/strict";
import hre from "hardhat";

describe("Ignition modules with the create2 strategy", async () => {
  const { ignition, viem, networkHelpers } = await hre.network.create();
  const [deployer, , operator] = await viem.getWalletClients();

  const salt = keccak256(toHex("kite-ignition"));
  const publicClient = await viem.getPublicClient();

  async function deployFixture() {
    return ignition.deploy(KiteFactoryModule, {
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
  }

  const implementationOf = async (proxy: `0x${string}`) => {
    const value = await publicClient.getStorageAt({
      address: proxy,
      slot: IMPLEMENTATION_SLOT,
    });

    return getAddress(`0x${value!.slice(-40)}`);
  };

  it("deploys the factory through CreateX", async () => {
    const { KiteFactoryProxy, ProxyAdmin } = await networkHelpers.loadFixture(
      deployFixture,
    );

    assert.equal(
      await KiteFactoryProxy.read.hasRole([
        await KiteFactoryProxy.read.OPERATOR_ROLE(),
        operator.account.address,
      ]),
      true,
    );

    assert.equal(
      getAddress(await ProxyAdmin.read.owner()),
      getAddress(deployer.account.address),
    );
  });

  it("upgrades the factory and the Kite implementation", async () => {
    const { KiteFactoryProxy, ProxyAdmin } = await networkHelpers.loadFixture(
      deployFixture,
    );

    const implementationBefore = await implementationOf(
      KiteFactoryProxy.address,
    );

    const kiteBefore = await KiteFactoryProxy.read.implementation();

    // the code hasn't changed, so a new salt is needed for a new CreateX address
    await ignition.deploy(KiteFactoryUpgradeModule, {
      strategy: "create2",
      strategyConfig: {
        salt: keccak256(toHex("kite-ignition-v2")),
      },
      parameters: {
        KiteFactoryUpgradeModule: {
          proxyAdmin: ProxyAdmin.address,
          factory: KiteFactoryProxy.address,
        },
      },
      displayUi: false,
    });

    assert.notEqual(
      await implementationOf(KiteFactoryProxy.address),
      implementationBefore,
    );

    const { Kite } = await ignition.deploy(KiteImplementationModule, {
      strategy: "create2",
      strategyConfig: {
        salt,
      },
      parameters: {
        KiteImplementationModule: {
          factory: KiteFactoryProxy.address,
        },
      },
      displayUi: false,
    });

    const kiteAfter = await KiteFactoryProxy.read.implementation();
    assert.notEqual(kiteAfter, kiteBefore);
    assert.equal(getAddress(kiteAfter), getAddress(Kite.address));
    assert.equal(
      await KiteFactoryProxy.read.isImplementation([kiteBefore]),
      true,
    );
  });
});
