// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPeripheryImmutableState} from "@uniswap/v3-periphery/contracts/interfaces/IPeripheryImmutableState.sol";
import {IV3SwapRouter} from "@uniswap/swap-router-contracts/contracts/interfaces/IV3SwapRouter.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ITransfer} from "../interfaces/types/ITransfer.sol";
import {IFee} from "../interfaces/types/IFee.sol";
import {IWETH9} from "../interfaces/IWETH9.sol";

library Common {
    using SafeERC20 for IERC20;

    function isZeroAddress(address value) internal pure returns (bool) {
        return value == address(0);
    }

    function totalFees(
        IFee.Fee[] memory fees
    ) internal pure returns (uint256 total) {
        for (uint256 i; i < fees.length; ++i) {
            total += fees[i].amount;
        }
    }

    function balanceOf(address token) internal view returns (uint256) {
        return
            isZeroAddress(token)
                ? address(this).balance
                : IERC20(token).balanceOf(address(this));
    }

    function swap(
        ITransfer.Transfer memory transfer
    ) internal returns (uint256 amountOut) {
        address weth = IPeripheryImmutableState(transfer.routerAddress).WETH9();
        bool nativeIn = isZeroAddress(transfer.payInTokenAddress);
        bool nativeOut = isZeroAddress(transfer.settlementTokenAddress);

        address tokenIn = nativeIn ? weth : transfer.payInTokenAddress;
        address tokenOut = nativeOut ? weth : transfer.settlementTokenAddress;

        if (nativeIn) IWETH9(weth).deposit{value: transfer.amountIn}();

        IERC20(tokenIn).forceApprove(transfer.routerAddress, transfer.amountIn);

        amountOut = IV3SwapRouter(transfer.routerAddress).exactInputSingle(
            IV3SwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: transfer.poolFeeTier,
                recipient: address(this),
                amountIn: transfer.amountIn,
                amountOutMinimum: transfer.minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );

        if (nativeOut) IWETH9(weth).withdraw(amountOut);
    }

    function send(address token, address to, uint256 amount) internal {
        if (isZeroAddress(token)) Address.sendValue(payable(to), amount);
        else IERC20(token).safeTransfer(to, amount);
    }
}
