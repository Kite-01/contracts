// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IGeneralErrors} from "./interfaces/IGeneralErrors.sol";
import {IKiteFactory} from "./interfaces/IKiteFactory.sol";
import {IKite} from "./interfaces/IKite.sol";
import {ITransfer} from "./interfaces/types/ITransfer.sol";
import {Deployer} from "./libraries/Deployer.sol";
import {Storage} from "./libraries/Storage.sol";
import {Common} from "./libraries/Common.sol";
import {Kite} from "./Kite.sol";

contract KiteFactory is AccessControlUpgradeable, IKiteFactory {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address operator) external initializer {
        if (Common.isZeroAddress(admin)) {
            revert IGeneralErrors.ZeroAddress();
        }

        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        if (!Common.isZeroAddress(operator)) {
            _grantRole(OPERATOR_ROLE, operator);
        }

        Storage.setImplementation(address(new Kite(address(this))));
    }

    function implementation() external view returns (address) {
        return Storage.getStorage().implementation;
    }

    function isImplementation(
        address implementation_
    ) public view returns (bool) {
        return Storage.getStorage().isImplementation[implementation_];
    }

    function setImplementation(
        address implementation_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (
            implementation_.code.length == 0 ||
            Kite(payable(implementation_)).factory() != address(this)
        ) {
            revert IGeneralErrors.InvalidConfig();
        }

        Storage.setImplementation(implementation_);
    }

    function predictAddress(
        ITransfer.Transfer calldata transfer
    ) external view returns (address) {
        return Deployer.predictAddress(transfer, _implementationOf(transfer));
    }

    function deploy(
        ITransfer.Transfer calldata transfer
    ) external onlyRole(OPERATOR_ROLE) returns (address) {
        return
            Deployer.getOrDeployAddress(transfer, _implementationOf(transfer));
    }

    function settle(
        ITransfer.Transfer calldata transfer
    ) external onlyRole(OPERATOR_ROLE) {
        address instance = Deployer.getOrDeployAddress(
            transfer,
            _implementationOf(transfer)
        );

        IKite(payable(instance)).settle();
    }

    function refund(ITransfer.Transfer calldata transfer) external {
        if (block.timestamp <= transfer.expiresAt) {
            _checkRole(OPERATOR_ROLE);
        }

        address instance = Deployer.getOrDeployAddress(
            transfer,
            _implementationOf(transfer)
        );

        IKite(payable(instance)).refund();
    }

    function recover(
        ITransfer.Transfer calldata transfer,
        address token,
        address destinationAddress
    ) external onlyRole(OPERATOR_ROLE) {
        address instance = Deployer.getOrDeployAddress(
            transfer,
            _implementationOf(transfer)
        );

        IKite(payable(instance)).recover(token, destinationAddress);
    }

    function _implementationOf(
        ITransfer.Transfer calldata transfer
    ) private view returns (address) {
        if (!isImplementation(transfer.implementation)) {
            revert IGeneralErrors.UnknownImplementation(
                transfer.implementation
            );
        }

        return transfer.implementation;
    }
}
