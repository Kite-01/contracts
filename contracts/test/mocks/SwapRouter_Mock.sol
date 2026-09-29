// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IV3SwapRouter} from "@uniswap/swap-router-contracts/contracts/interfaces/IV3SwapRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20_Mock} from "./ERC20_Mock.sol";

contract SwapRouter_Mock {
    address public immutable WETH9;
    uint256 public rateNum = 1;
    uint256 public rateDen = 1;

    constructor(address weth) {
        WETH9 = weth;
    }

    function setRate(uint256 n, uint256 d) external {
        rateNum = n;
        rateDen = d;
    }

    function exactInputSingle(
        IV3SwapRouter.ExactInputSingleParams calldata p
    ) external payable returns (uint256 out) {
        require(msg.value == 0, "No value expected");
        IERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        out = (p.amountIn * rateNum) / rateDen;
        require(out >= p.amountOutMinimum, "Too little received");
        ERC20_Mock(p.tokenOut).mint(p.recipient, out);
    }
}
