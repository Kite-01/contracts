// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IFee {
    struct Fee {
        bytes32 id;
        address recipient;
        uint256 amount;
    }
}
