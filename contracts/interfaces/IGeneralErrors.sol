// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGeneralErrors {
    error BelowMin(uint256 amountOut, uint256 minAmountOut);
    error InsufficientPayment(uint256 balance, uint256 required);
    error ZeroAddress();
    error InvalidConfig();
    error TooManyFees();
    error InvoiceNotOpen(bytes32 transferId);
    error Expired(bytes32 transferId);
    error NotExpired(bytes32 transferId);
    error NativeNotAccepted();
    error RecoveryNotAllowed();
    error OnlyFactory();
    error InsufficientGas();
    error RefundFailed(address to);
}
