// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IKite {
    enum Status {
        Uninitialized,
        Open,
        Executing,
        Settled,
        Refunded
    }

    function initialize() external;

    function settle() external;

    function refund() external;

    function recover(address token, address destinationAddress) external;

    event Settled(
        bytes32 indexed transferId,
        address indexed settlementRecipient,
        address indexed settlementToken,
        address payInToken,
        uint256 amountIn,
        uint256 amountOut, // gross, before fee
        uint256 feeAmount
    );

    event FeePaid(
        bytes32 indexed transferId,
        bytes32 indexed feeId,
        address indexed token,
        address recipient,
        uint256 amount
    );

    event Refunded(
        bytes32 indexed transferId,
        address indexed refundAddress,
        address indexed payInToken,
        uint256 amountRefunded
    );

    event ExcessRefunded(
        bytes32 indexed transferId,
        address indexed token,
        address indexed to,
        uint256 amount
    );

    event Recovered(
        bytes32 indexed transferId,
        address indexed token,
        address indexed to,
        uint256 amount
    );
}
