// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IFee} from "./IFee.sol";

interface ITransfer {
    struct Transfer {
        bytes32 id;
        address payInTokenAddress;
        uint256 amountIn;
        address settlementTokenAddress;
        address settlementRecipient;
        uint256 minAmountOut;
        IFee.Fee[] fees;
        address refundAddress;
        uint256 expiresAt;
        address routerAddress;
        // Uniswap V3 pool fee; 0 swaps through a Uniswap V2 router instead
        // when token in and out is not same
        uint24 poolFeeTier;
        address implementation;
    }
}
