import { type Address, type Hex } from "viem";

/**
 *
 * @see https://github.com/pcaversaccio/createx
 */
export const CREATE_X: Address = "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed";

/**
 *
 * ERC-1967 slots of a TransparentUpgradeableProxy
 */
export const IMPLEMENTATION_SLOT: Hex =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const ADMIN_SLOT: Hex =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
