import { createXDeploy } from "./createx.js";
import {
  type Abi,
  type Address,
  type Hex,
  encodeDeployData,
  encodeFunctionData,
  getContractAddress,
  zeroHash,
} from "viem";

interface Artifact {
  abi: Abi;
  bytecode: Hex;
}

interface Deployer {
  sender: Address;
  chainId: number;
  salt?: Hex;
}

export interface FactoryDeploymentParams extends Deployer {
  kiteFactory: Artifact;
  transparentUpgradeableProxy: Artifact;
  admin: Address;
  operator: Address;
  proxyOwner: Address;
}

export function planFactoryDeployment({
  kiteFactory,
  transparentUpgradeableProxy,
  admin,
  operator,
  proxyOwner,
  sender,
  chainId,
  salt = zeroHash,
}: FactoryDeploymentParams) {
  const implementationDeploy = createXDeploy({
    initCode: kiteFactory.bytecode,
    salt,
    sender,
    chainId,
  });

  const implementation = implementationDeploy.address;
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

  const factoryDeploy = createXDeploy({
    initCode: proxyInitCode,
    salt,
    sender,
    chainId,
  });

  const factory = factoryDeploy.address;
  const proxyAdmin = getContractAddress({
    from: factory,
    nonce: 2n,
  });

  return {
    implementation,
    factory,
    proxyAdmin,
    proxyConstructorArgs,
    implementationCall: implementationDeploy.call,
    factoryCall: factoryDeploy.call,
  };
}

export interface FactoryUpgradeParams extends Deployer {
  kiteFactory: Artifact;
  proxyAdmin: Artifact;
  factory: Address;
  proxyAdminAddress: Address;
  callData?: Hex;
}

export function planFactoryUpgrade({
  kiteFactory,
  proxyAdmin,
  factory,
  proxyAdminAddress,
  callData = "0x",
  sender,
  chainId,
  salt = zeroHash,
}: FactoryUpgradeParams) {
  const { address: implementation, call: implementationCall } = createXDeploy({
    initCode: kiteFactory.bytecode,
    salt,
    sender,
    chainId,
  });

  return {
    implementation,
    implementationCall,
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

export interface KiteUpgradeParams extends Deployer {
  kite: Artifact;
  kiteFactory: Artifact;
  factory: Address;
}

export function planKiteUpgrade({
  kite,
  kiteFactory,
  factory,
  sender,
  chainId,
  salt = zeroHash,
}: KiteUpgradeParams) {
  const constructorArgs = [factory] as const;
  const initCode = encodeDeployData({
    abi: kite.abi,
    bytecode: kite.bytecode,
    args: constructorArgs,
  });

  const { address: implementation, call: implementationCall } = createXDeploy({
    initCode,
    salt,
    sender,
    chainId,
  });

  return {
    implementation,
    initCode,
    constructorArgs,
    implementationCall,
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
