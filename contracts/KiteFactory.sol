// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IKiteFactory} from "./interfaces/IKiteFactory.sol";
import {IKite} from "./interfaces/IKite.sol";
import {ITransfer} from "./interfaces/types/ITransfer.sol";
import {Deployer} from "./libraries/Deployer.sol";
import {Common} from "./libraries/Common.sol";
import {Kite} from "./Kite.sol";

contract KiteFactory is AccessControl, IKiteFactory {
    address public immutable implementation;
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    constructor(address admin, address operator) {
        require(!Common.isZeroAddress(admin), "admin=0");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        implementation = address(new Kite(address(this)));

        if (!Common.isZeroAddress(operator)) {
            _grantRole(OPERATOR_ROLE, operator);
        }
    }

    function predictAddress(
        ITransfer.Transfer calldata transfer
    ) external view returns (address) {
        return Deployer.predictAddress(transfer, implementation);
    }

    function deploy(
        ITransfer.Transfer calldata transfer
    ) external onlyRole(OPERATOR_ROLE) returns (address) {
        return Deployer.getOrDeployAddress(transfer, implementation);
    }

    function settle(
        ITransfer.Transfer calldata transfer
    ) external onlyRole(OPERATOR_ROLE) {
        address instance = Deployer.getOrDeployAddress(
            transfer,
            implementation
        );

        IKite(payable(instance)).settle();
    }

    function refund(ITransfer.Transfer calldata transfer) external {
        if (block.timestamp <= transfer.expiresAt) {
            _checkRole(OPERATOR_ROLE);
        }

        address instance = Deployer.getOrDeployAddress(
            transfer,
            implementation
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
            implementation
        );

        IKite(payable(instance)).recover(token, destinationAddress);
    }
}
