// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IGeneralErrors} from "./interfaces/IGeneralErrors.sol";
import {ITransfer} from "./interfaces/types/ITransfer.sol";
import {IFee} from "./interfaces/types/IFee.sol";
import {Deployer} from "./libraries/Deployer.sol";
import {Constants} from "./libraries/Constants.sol";
import {Common} from "./libraries/Common.sol";
import {IKite} from "./interfaces/IKite.sol";

contract Kite is Initializable, IKite {
    address public immutable factory;
    IKite.Status public status;

    constructor(address factory_) {
        if (Common.isZeroAddress(factory_)) revert IGeneralErrors.ZeroAddress();

        factory = factory_;
        _disableInitializers();
    }

    receive() external payable {}

    modifier onlyFactory() {
        if (msg.sender != factory) revert IGeneralErrors.OnlyFactory();
        _;
    }

    function initialize() external initializer onlyFactory {
        ITransfer.Transfer memory transfer = Deployer.getTransfer();

        if (
            Common.isZeroAddress(transfer.settlementRecipient) ||
            Common.isZeroAddress(transfer.refundAddress)
        ) {
            revert IGeneralErrors.ZeroAddress();
        }

        if (transfer.fees.length > Constants.MAX_FEES) {
            revert IGeneralErrors.TooManyFees();
        }

        for (uint256 i; i < transfer.fees.length; ++i) {
            if (Common.isZeroAddress(transfer.fees[i].recipient)) {
                revert IGeneralErrors.ZeroAddress();
            }

            if (transfer.fees[i].amount == 0) {
                revert IGeneralErrors.InvalidConfig();
            }
        }

        if (
            transfer.amountIn == 0 ||
            transfer.minAmountOut < Common.totalFees(transfer.fees)
        ) {
            revert IGeneralErrors.InvalidConfig();
        }

        if (
            transfer.payInTokenAddress != transfer.settlementTokenAddress &&
            Common.isZeroAddress(transfer.routerAddress)
        ) {
            revert IGeneralErrors.ZeroAddress();
        }

        status = IKite.Status.Open;
    }

    function settle() external onlyFactory {
        ITransfer.Transfer memory transfer = Deployer.getTransfer();

        if (status != Status.Open) {
            revert IGeneralErrors.InvoiceNotOpen(transfer.id);
        }

        if (block.timestamp > transfer.expiresAt) {
            revert IGeneralErrors.Expired(transfer.id);
        }

        status = IKite.Status.Executing;

        uint256 balance = Common.balanceOf(transfer.payInTokenAddress);
        if (balance < transfer.amountIn) {
            revert IGeneralErrors.InsufficientPayment(
                balance,
                transfer.amountIn
            );
        }

        uint256 excess = balance - transfer.amountIn;
        uint256 amountOut = transfer.payInTokenAddress ==
            transfer.settlementTokenAddress
            ? transfer.amountIn
            : Common.swap(transfer);

        if (amountOut < transfer.minAmountOut) {
            revert IGeneralErrors.BelowMin(amountOut, transfer.minAmountOut);
        }

        status = Status.Settled;

        uint256 totalFees = Common.totalFees(transfer.fees);

        for (uint256 i; i < transfer.fees.length; ++i) {
            IFee.Fee memory fee = transfer.fees[i];
            Common.send(
                transfer.settlementTokenAddress,
                fee.recipient,
                fee.amount
            );

            emit IKite.FeePaid(
                transfer.id,
                fee.id,
                fee.recipient,
                transfer.settlementTokenAddress,
                fee.amount
            );
        }

        Common.send(
            transfer.settlementTokenAddress,
            transfer.settlementRecipient,
            amountOut - totalFees
        );

        emit IKite.Settled(
            transfer.id,
            transfer.settlementRecipient,
            transfer.settlementTokenAddress,
            transfer.payInTokenAddress,
            transfer.amountIn,
            amountOut,
            totalFees
        );

        // Overpayment goes back last and must not block settlement: if the refund
        // address can't take it, it stays here for operator to recover.
        if (
            excess != 0 &&
            Common.trySend(
                transfer.payInTokenAddress,
                transfer.refundAddress,
                excess
            )
        ) {
            emit IKite.ExcessRefunded(
                transfer.id,
                transfer.payInTokenAddress,
                transfer.refundAddress,
                excess
            );
        }
    }

    function refund() external {
        ITransfer.Transfer memory transfer = Deployer.getTransfer();

        if (msg.sender != factory && block.timestamp <= transfer.expiresAt) {
            revert IGeneralErrors.NotExpired(transfer.id);
        }

        if (status != Status.Open) {
            revert IGeneralErrors.InvoiceNotOpen(transfer.id);
        }

        status = IKite.Status.Refunded;

        uint256 balance = Common.balanceOf(transfer.payInTokenAddress);
        uint256 amountRefunded = 0;

        if (balance != 0) {
            address to = transfer.refundAddress;
            bool success = Common.trySend(
                transfer.payInTokenAddress,
                to,
                balance
            );

            // refund destination may be a contract that rejects ETH
            // in that case, leave the funds here so operator can recover them
            if (success) amountRefunded = balance;
        }

        emit IKite.Refunded(
            transfer.id,
            transfer.refundAddress,
            transfer.payInTokenAddress,
            amountRefunded
        );
    }

    function recover(
        address token,
        address destinationAddress
    ) external onlyFactory {
        ITransfer.Transfer memory transfer = Deployer.getTransfer();

        if (
            status == IKite.Status.Uninitialized ||
            status == IKite.Status.Executing
        ) {
            revert IGeneralErrors.InvoiceNotOpen(transfer.id);
        }

        if (
            status == IKite.Status.Open &&
            (token == transfer.payInTokenAddress ||
                token == transfer.settlementTokenAddress)
        ) revert IGeneralErrors.RecoveryNotAllowed();

        address to = Common.isZeroAddress(destinationAddress)
            ? transfer.refundAddress
            : destinationAddress;

        uint256 amount = Common.balanceOf(token);
        if (amount != 0) {
            Common.send(token, to, amount);
        }

        emit IKite.Recovered(transfer.id, token, to, amount);
    }
}
