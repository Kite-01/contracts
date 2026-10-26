// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITransfer} from "./types/ITransfer.sol";

interface IKiteFactory is ITransfer {
    function implementation() external view returns (address);

    function isImplementation(
        address implementation_
    ) external view returns (bool);

    function setImplementation(address implementation_) external;

    function predictAddress(
        ITransfer.Transfer calldata transfer
    ) external view returns (address);

    function deploy(
        ITransfer.Transfer calldata transfer
    ) external returns (address);

    function settle(ITransfer.Transfer calldata transfer) external;

    function refund(ITransfer.Transfer calldata transfer) external;

    function recover(
        ITransfer.Transfer calldata transfer,
        address token,
        address destinationAddress
    ) external;

    event Deployed(bytes32 indexed transferId, address indexed kite);
}
