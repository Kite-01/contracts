import { CREATE2_DEPLOYER } from "./constants.js";
import {
  type Abi,
  type Address,
  type Hex,
  concat,
  encodeDeployData,
  encodeFunctionData,
  getContractAddress,
  zeroHash,
} from "viem";

interface Artifact {
  abi: Abi;
  bytecode: Hex;
}

export interface FactoryDeploymentParams {
  kiteFactory: Artifact;
  transparentUpgradeableProxy: Artifact;
  /** Gets DEFAULT_ADMIN_ROLE on the factory */
  admin: Address;
  /** Gets OPERATOR_ROLE on the factory */
  operator: Address;
  /** Owns the ProxyAdmin, i.e. can upgrade the factory */
  proxyOwner: Address;
  salt?: Hex;
}

export function planFactoryDeployment({
  kiteFactory,
  transparentUpgradeableProxy,
  admin,
  operator,
  proxyOwner,
  salt = zeroHash,
}: FactoryDeploymentParams) {
  const implementation = getContractAddress({
    opcode: "CREATE2",
    from: CREATE2_DEPLOYER,
    bytecode: kiteFactory.bytecode,
    salt,
  });

  const proxyConstructorArgs = [
    implementation,
    proxyOwner,
    encodeFunctionData({
      abi: kiteFactory.abi,
      functionName: "initialize",
      args: [admin, operator],
    }),
  ] as const;

  const proxyInitCode = encodeDeployData({
    abi: transparentUpgradeableProxy.abi,
    bytecode: transparentUpgradeableProxy.bytecode,
    args: proxyConstructorArgs,
  });

  const factory = getContractAddress({
    opcode: "CREATE2",
    from: CREATE2_DEPLOYER,
    salt,
    bytecode: proxyInitCode,
  });

  const proxyAdmin = getContractAddress({
    from: factory,
    nonce: 2n,
  });

  return {
    implementation,
    factory,
    proxyAdmin,
    proxyConstructorArgs,
    implementationCall: {
      to: CREATE2_DEPLOYER,
      data: concat([salt, kiteFactory.bytecode]),
    },
    factoryCall: {
      to: CREATE2_DEPLOYER,
      data: concat([salt, proxyInitCode]),
    },
  };
}

export interface FactoryUpgradeParams {
  kiteFactory: Artifact;
  proxyAdmin: Artifact;
  factory: Address;
  proxyAdminAddress: Address;
  /** Data for a call on the factory right after the upgrade (default: none) */
  callData?: Hex;
  salt?: Hex;
}

/**
 *
 * The upgrade call must come from the ProxyAdmin's owner
 */
export function planFactoryUpgrade({
  kiteFactory,
  proxyAdmin,
  factory,
  proxyAdminAddress,
  callData = "0x",
  salt = zeroHash,
}: FactoryUpgradeParams) {
  const implementation = getContractAddress({
    opcode: "CREATE2",
    from: CREATE2_DEPLOYER,
    salt,
    bytecode: kiteFactory.bytecode,
  });

  return {
    implementation,
    implementationCall: {
      to: CREATE2_DEPLOYER,
      data: concat([salt, kiteFactory.bytecode]),
    },
    upgradeCall: {
      to: proxyAdminAddress,
      data: encodeFunctionData({
        abi: proxyAdmin.abi,
        functionName: "upgradeAndCall",
        args: [factory, implementation, callData],
      }),
    },
  };
}

export interface KiteUpgradeParams {
  kite: Artifact;
  kiteFactory: Artifact;
  /** The KiteFactory proxy the new Kite belongs to */
  factory: Address;
  salt?: Hex;
}

export function planKiteUpgrade({
  kite,
  kiteFactory,
  factory,
  salt = zeroHash,
}: KiteUpgradeParams) {
  const constructorArgs = [factory] as const;
  const initCode = encodeDeployData({
    abi: kite.abi,
    bytecode: kite.bytecode,
    args: constructorArgs,
  });

  const implementation = getContractAddress({
    opcode: "CREATE2",
    from: CREATE2_DEPLOYER,
    salt,
    bytecode: initCode,
  });

  return {
    implementation,
    initCode,
    constructorArgs,
    implementationCall: {
      to: CREATE2_DEPLOYER,
      data: concat([salt, initCode]),
    },
    setImplementationCall: {
      to: factory,
      data: encodeFunctionData({
        abi: kiteFactory.abi,
        functionName: "setImplementation",
        args: [implementation],
      }),
    },
  };
}
