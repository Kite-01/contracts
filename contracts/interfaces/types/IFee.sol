// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IFee {
    struct Fee {
        address recipient;
        uint256 amount;
    }
}
