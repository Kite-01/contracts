import "dotenv/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import hardhatTypechain from "@nomicfoundation/hardhat-typechain";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import { configVariable, defineConfig } from "hardhat/config";
import { zeroHash } from "viem";

const DefaultCompilerSettings = {
  version: "0.8.34",
  settings: {
    evmVersion: "paris",
    optimizer: {
      enabled: true,
      runs: 200,
    },
    metadata: {
      bytecodeHash: "none",
    },
  },
};

export default defineConfig({
  paths: {
    sources: "./contracts",
  },
  plugins: [hardhatToolboxViemPlugin, hardhatTypechain, hardhatVerify],
  solidity: {
    profiles: {
      default: {
        compilers: [DefaultCompilerSettings],
      },
      production: {
        compilers: [DefaultCompilerSettings],
      },
    },
    npmFilesToBuild: [
      "@uniswap/swap-router-contracts/contracts/interfaces/IV3SwapRouter.sol",
      "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol",
      "@openzeppelin/contracts/token/ERC20/IERC20.sol",
      "@openzeppelin/contracts/access/AccessControl.sol",
      "@openzeppelin/contracts/utils/Address.sol",
      "@openzeppelin/contracts/proxy/Clones.sol",
      "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol",
      "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol",
    ],
  },
  typechain: {
    outDir: "./typechain",
  },
  networks: {
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    mainnet: {
      type: "http",
      url: configVariable("FORK_URL"),
      accounts: [configVariable("PRIVATE_KEY")],
    },
  },
  ignition: {
    strategyConfig: {
      create2: {
        salt: process.env.IGNITION_SALT || zeroHash,
      },
    },
  },
  verify: {
    etherscan: {
      enabled: true,
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
    blockscout: {
      enabled: true,
    },
    sourcify: {
      enabled: true,
    },
  },
});
