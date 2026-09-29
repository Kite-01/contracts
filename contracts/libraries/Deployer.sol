// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IKiteFactory, ITransfer} from "../interfaces/IKiteFactory.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IKite} from "../interfaces/IKite.sol";

library Deployer {
    function _encode(
        ITransfer.Transfer calldata transfer
    ) private pure returns (bytes memory args, bytes32 salt) {
        args = abi.encode(transfer);
        salt = keccak256(args);
    }

    function _predictAddress(
        address implementation,
        ITransfer.Transfer calldata transfer
    ) private view returns (address instance, bytes memory args, bytes32 salt) {
        (args, salt) = _encode(transfer);
        instance = Clones.predictDeterministicAddressWithImmutableArgs(
            implementation,
            args,
            salt
        );
    }

    function predictAddress(
        ITransfer.Transfer calldata transfer,
        address implementation
    ) internal view returns (address instance) {
        (instance, , ) = _predictAddress(implementation, transfer);
    }

    function getOrDeployAddress(
        ITransfer.Transfer calldata transfer,
        address implementation
    ) internal returns (address instance) {
        bytes memory args;
        bytes32 salt;

        (instance, args, salt) = _predictAddress(implementation, transfer);

        if (instance.code.length == 0) {
            Clones.cloneDeterministicWithImmutableArgs(
                implementation,
                args,
                salt
            );

            IKite(payable(instance)).initialize();
            emit IKiteFactory.Deployed(transfer.id, instance);
        }
    }

    function getTransfer() internal view returns (ITransfer.Transfer memory) {
        return
            abi.decode(
                Clones.fetchCloneArgs(address(this)),
                (ITransfer.Transfer)
            );
    }
}
