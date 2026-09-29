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
        uint24 poolFeeTier;
    }
}
