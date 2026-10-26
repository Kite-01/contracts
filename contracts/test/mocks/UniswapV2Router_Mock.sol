// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20_Mock} from "./ERC20_Mock.sol";

contract UniswapV2Router_Mock {
    address public immutable WETH;
    uint256 public rateNum = 1;
    uint256 public rateDen = 1;

    constructor(address weth) {
        WETH = weth;
    }

    function setRate(uint256 n, uint256 d) external {
        rateNum = n;
        rateDen = d;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(deadline >= block.timestamp, "UniswapV2Router: EXPIRED");
        require(path.length == 2, "Single hop only");

        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        uint256 out = (amountIn * rateNum) / rateDen;
        require(
            out >= amountOutMin,
            "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT"
        );
        ERC20_Mock(path[1]).mint(to, out);

        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = out;
    }
}
