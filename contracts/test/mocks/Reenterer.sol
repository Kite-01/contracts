// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Reenterer {
    address public kite;
    bool public tried;
    bool public reenterFailed;

    function set(address k) external {
        kite = k;
    }

    receive() external payable {
        tried = true;
        (bool ok, ) = kite.call{value: 0}("");
        (bool ok2, ) = kite.call(abi.encodeWithSignature("refund()"));
        reenterFailed = !ok && !ok2;
    }
}
