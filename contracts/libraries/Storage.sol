// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library Storage {
    // keccak256(abi.encode(uint256(keccak256("kite.storage.KiteFactory")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STORAGE_SLOT =
        0xfb4b46aee607a12252ee01158123307e0609819a0aa9f63022f6031eb11b0d00;

    /// @custom:storage-location erc7201:kite.storage.KiteFactory
    struct KiteFactoryStorage {
        address implementation;
        mapping(address => bool) isImplementation;
    }

    event ImplementationSet(address indexed implementation);

    function getStorage() internal pure returns (KiteFactoryStorage storage s) {
        assembly {
            s.slot := STORAGE_SLOT
        }
    }

    function setImplementation(address implementation_) internal {
        KiteFactoryStorage storage s = getStorage();
        s.implementation = implementation_;
        s.isImplementation[implementation_] = true;

        emit ImplementationSet(implementation_);
    }
}
