// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPeripheryImmutableState} from "@uniswap/v3-periphery/contracts/interfaces/IPeripheryImmutableState.sol";
import {IUniswapV2Router02} from "../interfaces/IUniswapV2Router02.sol";
import {IGeneralErrors} from "../interfaces/IGeneralErrors.sol";
import {IV3SwapRouter} from "@uniswap/swap-router-contracts/contracts/interfaces/IV3SwapRouter.sol";
import {LowLevelCall} from "@openzeppelin/contracts/utils/LowLevelCall.sol";
import {ITransfer} from "../interfaces/types/ITransfer.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Constants} from "./Constants.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IWETH9} from "../interfaces/IWETH9.sol";
import {IFee} from "../interfaces/types/IFee.sol";

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
        bool v2 = transfer.poolFeeTier == 0;
        address weth = v2
            ? IUniswapV2Router02(transfer.routerAddress).WETH()
            : IPeripheryImmutableState(transfer.routerAddress).WETH9();

        bool nativeIn = isZeroAddress(transfer.payInTokenAddress);
        bool nativeOut = isZeroAddress(transfer.settlementTokenAddress);

        address tokenIn = nativeIn ? weth : transfer.payInTokenAddress;
        address tokenOut = nativeOut ? weth : transfer.settlementTokenAddress;

        if (nativeIn) IWETH9(weth).deposit{value: transfer.amountIn}();

        IERC20(tokenIn).forceApprove(transfer.routerAddress, transfer.amountIn);

        if (v2) {
            address[] memory path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;

            amountOut = IUniswapV2Router02(transfer.routerAddress)
                .swapExactTokensForTokens(
                    transfer.amountIn,
                    transfer.minAmountOut,
                    path,
                    address(this),
                    block.timestamp
                )[1];
        } else {
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
        }

        if (nativeOut) IWETH9(weth).withdraw(amountOut);
    }

    function send(address token, address to, uint256 amount) internal {
        if (isZeroAddress(token)) Address.sendValue(payable(to), amount);
        else IERC20(token).safeTransfer(to, amount);
    }

    function trySend(
        address token,
        address to,
        uint256 amount
    ) internal returns (bool) {
        if (gasleft() < Constants.MIN_SEND_GAS) {
            revert IGeneralErrors.InsufficientGas();
        }

        return
            isZeroAddress(token)
                ? LowLevelCall.callNoReturn(to, amount, "")
                : IERC20(token).trySafeTransfer(to, amount);
    }
}
