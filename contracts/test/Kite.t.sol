// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {KiteFactory} from "../KiteFactory.sol";
import {TransparentUpgradeableProxy, ITransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {Kite, IKite, IGeneralErrors} from "../Kite.sol";
import {Test, Vm} from "forge-std/Test.sol";
import {ITransfer} from "../interfaces/types/ITransfer.sol";
import {IFee} from "../interfaces/types/IFee.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {UniswapV2Router_Mock} from "./mocks/UniswapV2Router_Mock.sol";
import {SwapRouter_Mock} from "./mocks/SwapRouter_Mock.sol";
import {ERC20_Mock} from "./mocks/ERC20_Mock.sol";
import {WETH9_Mock} from "./mocks/WETH9_Mock.sol";
import {Reenterer} from "./mocks/Reenterer.sol";

contract KiteTest is Test {
    KiteFactory factory;
    ProxyAdmin proxyAdmin;
    WETH9_Mock weth;
    SwapRouter_Mock router;
    UniswapV2Router_Mock v2Router;
    ERC20_Mock usdc;
    ERC20_Mock usdt;

    uint256 private nextId = 1;

    address admin = makeAddr("admin");
    address operator = makeAddr("operator");
    address payer = makeAddr("payer");
    address merchant = makeAddr("merchant");
    address feeTo = makeAddr("feeTo");
    address refundTo = makeAddr("refundTo");

    function setUp() public {
        factory = KiteFactory(
            address(
                new TransparentUpgradeableProxy(
                    address(new KiteFactory()),
                    admin,
                    abi.encodeCall(KiteFactory.initialize, (admin, operator))
                )
            )
        );

        proxyAdmin = ProxyAdmin(proxySlot(ERC1967Utils.ADMIN_SLOT));

        weth = new WETH9_Mock();
        router = new SwapRouter_Mock(address(weth));
        v2Router = new UniswapV2Router_Mock(address(weth));
        usdc = new ERC20_Mock("USDC");
        usdt = new ERC20_Mock("USDT");

        vm.deal(address(weth), 1000 ether);
        vm.deal(payer, 100 ether);
    }

    function proxySlot(bytes32 slot) internal view returns (address) {
        return address(uint160(uint256(vm.load(address(factory), slot))));
    }

    function upgradeFactory(address caller, address next) internal {
        vm.prank(caller);
        proxyAdmin.upgradeAndCall(
            ITransparentUpgradeableProxy(address(factory)),
            next,
            ""
        );
    }

    function deploy(
        ITransfer.Transfer memory _transfer
    ) internal returns (address) {
        vm.prank(operator);
        return factory.deploy(_transfer);
    }

    function id() internal returns (bytes32) {
        return bytes32(nextId++);
    }

    function transfer(
        bytes32 id_,
        address tokenIn_,
        uint256 amountIn_,
        address tokenOut_,
        uint256 minAmountOut_,
        uint256 fee_
    ) internal view returns (ITransfer.Transfer memory) {
        IFee.Fee[] memory fees = new IFee.Fee[](fee_ == 0 ? 0 : 1);

        if (fee_ != 0) fees[0] = IFee.Fee(bytes32(uint256(1)), feeTo, fee_);

        return
            ITransfer.Transfer({
                id: id_,
                payInTokenAddress: tokenIn_,
                amountIn: amountIn_,
                settlementTokenAddress: tokenOut_,
                minAmountOut: minAmountOut_,
                settlementRecipient: merchant,
                fees: fees,
                refundAddress: refundTo,
                expiresAt: block.timestamp + 1 hours,
                routerAddress: address(router),
                poolFeeTier: 3000,
                implementation: factory.implementation()
            });
    }

    function useV2(
        ITransfer.Transfer memory t
    ) internal view returns (ITransfer.Transfer memory) {
        t.routerAddress = address(v2Router);
        t.poolFeeTier = 0;
        return t;
    }

    function test_nativeToNative_receiveAfterDeploy() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(0),
            1 ether,
            address(0),
            1 ether,
            0.01 ether
        );

        address predictedAddress = factory.predictAddress(t);
        assertEq(predictedAddress.code.length, 0);

        address instance = deploy(t);
        assertEq(instance, predictedAddress);
        assertNotEq(instance.code.length, 0);

        vm.prank(payer);
        (bool ok, ) = instance.call{value: 1 ether}("");

        assertTrue(ok);

        assertEq(instance.balance, 1 ether);

        vm.prank(operator);
        factory.settle(t);

        assertEq(merchant.balance, 0.99 ether);
        assertEq(feeTo.balance, 0.01 ether);
        assertEq(instance.balance, 0);

        assertEq(
            uint8(Kite(payable(instance)).status()),
            uint8(IKite.Status.Settled)
        );
    }

    function test_underpaidNativeRevertsOnSettlement() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(0),
            1 ether,
            address(0),
            1 ether,
            0
        );

        address instance = deploy(t);

        vm.prank(payer);
        (bool ok, ) = instance.call{value: 0.5 ether}("");
        assertTrue(ok);
        assertEq(payer.balance, 99.5 ether);

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                IGeneralErrors.InsufficientPayment.selector,
                0.5 ether,
                1 ether
            )
        );

        factory.settle(t);
    }

    function test_nativeToNative_counterfactual() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(0),
            1 ether,
            address(0),
            1 ether,
            0.01 ether
        );
        address instance = factory.predictAddress(t);

        vm.prank(payer);
        (bool ok, ) = instance.call{value: 1 ether}("");
        assertTrue(ok);

        vm.prank(operator);
        factory.settle(t);

        assertEq(merchant.balance, 0.99 ether);
        assertEq(feeTo.balance, 0.01 ether);
        assertEq(instance.balance, 0);
    }

    function test_erc20Same_counterfactual() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            100e6,
            1e6
        );
        address instance = factory.predictAddress(t);
        usdc.mint(instance, 100e6);

        vm.prank(operator);
        factory.settle(t);

        assertEq(usdc.balanceOf(merchant), 99e6);
        assertEq(usdc.balanceOf(feeTo), 1e6);
    }

    function test_erc20InsufficientPaymentAndOnlyOperator() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            100e6,
            1e6
        );
        address instance = factory.predictAddress(t);
        usdc.mint(instance, 50e6);

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                IGeneralErrors.InsufficientPayment.selector,
                50e6,
                100e6
            )
        );
        factory.settle(t);

        usdc.mint(instance, 50e6);
        vm.prank(payer);
        vm.expectRevert();
        factory.settle(t);

        vm.prank(operator);
        factory.settle(t);
    }

    function test_nativeToErc20_swap() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(0),
            1 ether,
            address(usdc),
            2000e6,
            10e6
        );

        router.setRate(2500e6, 1 ether);
        address instance = deploy(t);

        vm.prank(payer);
        (bool ok, ) = instance.call{value: 1 ether}("");
        assertTrue(ok);

        vm.prank(operator);
        factory.settle(t);

        assertEq(usdc.balanceOf(merchant), 2490e6);
        assertEq(usdc.balanceOf(feeTo), 10e6);
        assertEq(instance.balance, 0);
    }

    function test_nativeToErc20_belowMinRevertsAndRemainsOpen() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(0),
            1 ether,
            address(usdc),
            2000e6,
            10e6
        );

        router.setRate(1900e6, 1 ether);
        address instance = deploy(t);

        vm.prank(payer);
        (bool ok, ) = instance.call{value: 1 ether}("");
        assertTrue(ok);

        vm.prank(operator);
        vm.expectRevert();
        factory.settle(t);

        assertEq(payer.balance, 99 ether);
        assertEq(
            uint8(Kite(payable(instance)).status()),
            uint8(IKite.Status.Open)
        );
    }

    function test_erc20ToNative_unwrap() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            2500e6,
            address(0),
            1 ether,
            0.01 ether
        );

        router.setRate(1 ether, 2500e6);
        address instance = factory.predictAddress(t);
        usdc.mint(instance, 2500e6);

        vm.prank(operator);
        factory.settle(t);

        assertEq(merchant.balance, 0.99 ether);
        assertEq(feeTo.balance, 0.01 ether);
        assertEq(instance.balance, 0);
        assertEq(
            uint8(Kite(payable(instance)).status()),
            uint8(IKite.Status.Settled)
        );
    }

    function test_erc20ToDifferentErc20() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdt),
            99e6,
            1e6
        );

        router.setRate(995, 1000);
        address instance = factory.predictAddress(t);
        usdc.mint(instance, 100e6);

        vm.prank(operator);
        factory.settle(t);

        assertEq(usdt.balanceOf(merchant), 98.5e6);
        assertEq(usdt.balanceOf(feeTo), 1e6);
        assertEq(usdc.allowance(instance, address(router)), 0);
    }

    function test_v2_nativeToErc20_swap() public {
        ITransfer.Transfer memory t = useV2(
            transfer(id(), address(0), 1 ether, address(usdc), 2000e6, 10e6)
        );

        v2Router.setRate(2500e6, 1 ether);
        address instance = deploy(t);

        vm.prank(payer);
        (bool ok, ) = instance.call{value: 1 ether}("");
        assertTrue(ok);

        vm.prank(operator);
        factory.settle(t);

        assertEq(usdc.balanceOf(merchant), 2490e6);
        assertEq(usdc.balanceOf(feeTo), 10e6);
        assertEq(instance.balance, 0);
    }

    function test_v2_erc20ToNative_unwrap() public {
        ITransfer.Transfer memory t = useV2(
            transfer(
                id(),
                address(usdc),
                2500e6,
                address(0),
                1 ether,
                0.01 ether
            )
        );

        v2Router.setRate(1 ether, 2500e6);
        address instance = factory.predictAddress(t);
        usdc.mint(instance, 2500e6);

        vm.prank(operator);
        factory.settle(t);

        assertEq(merchant.balance, 0.99 ether);
        assertEq(feeTo.balance, 0.01 ether);
        assertEq(instance.balance, 0);
    }

    function test_v2_erc20ToDifferentErc20() public {
        ITransfer.Transfer memory t = useV2(
            transfer(id(), address(usdc), 100e6, address(usdt), 99e6, 1e6)
        );

        v2Router.setRate(995, 1000);
        address instance = factory.predictAddress(t);
        usdc.mint(instance, 100e6);

        vm.prank(operator);
        factory.settle(t);

        assertEq(usdt.balanceOf(merchant), 98.5e6);
        assertEq(usdt.balanceOf(feeTo), 1e6);
        assertEq(usdc.allowance(instance, address(v2Router)), 0);
    }

    function test_v2_belowMinRevertsAndRemainsOpen() public {
        ITransfer.Transfer memory t = useV2(
            transfer(id(), address(0), 1 ether, address(usdc), 2000e6, 10e6)
        );

        v2Router.setRate(1900e6, 1 ether);
        address instance = deploy(t);

        vm.prank(payer);
        (bool ok, ) = instance.call{value: 1 ether}("");
        assertTrue(ok);

        vm.prank(operator);
        vm.expectRevert(bytes("UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT"));
        factory.settle(t);

        assertEq(instance.balance, 1 ether);
        assertEq(
            uint8(Kite(payable(instance)).status()),
            uint8(IKite.Status.Open)
        );
    }

    function test_refundOperatorAndPublicAfterExpiry() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            100e6,
            1e6
        );

        address instance = factory.predictAddress(t);
        usdc.mint(instance, 100e6);

        vm.prank(payer);
        vm.expectRevert();
        factory.refund(t);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(payer);
        factory.refund(t);

        assertEq(usdc.balanceOf(refundTo), 100e6);
        assertEq(
            uint8(Kite(payable(instance)).status()),
            uint8(IKite.Status.Refunded)
        );
    }

    function test_directRefundOnCloneAfterExpiry() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(0),
            1 ether,
            address(0),
            1 ether,
            0
        );

        address instance = factory.predictAddress(t);
        vm.deal(instance, 1 ether);
        deploy(t);

        vm.expectRevert();
        Kite(payable(instance)).refund();

        vm.warp(block.timestamp + 2 hours);
        Kite(payable(instance)).refund();
        assertEq(refundTo.balance, 1 ether);
    }

    function test_operatorRefundBeforeExpiry() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            100e6,
            1e6
        );

        address instance = factory.predictAddress(t);
        usdc.mint(instance, 40e6);

        vm.prank(operator);
        factory.refund(t);
        assertEq(usdc.balanceOf(refundTo), 40e6);
    }

    function test_recoverLateDepositAfterSettle() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            100e6,
            1e6
        );

        address instance = factory.predictAddress(t);
        usdc.mint(instance, 100e6);

        vm.prank(operator);
        factory.settle(t);
        usdc.mint(instance, 7e6);

        vm.prank(operator);
        factory.recover(t, address(usdc), address(0));
        assertEq(usdc.balanceOf(refundTo), 7e6);
    }

    function test_recoverBlocksInvoiceTokensWhileOpen() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            100e6,
            1e6
        );

        address instance = factory.predictAddress(t);
        usdc.mint(instance, 100e6);
        usdt.mint(instance, 5e6);

        vm.prank(operator);
        vm.expectRevert(IGeneralErrors.RecoveryNotAllowed.selector);
        factory.recover(t, address(usdc), address(0));

        vm.prank(operator);
        factory.recover(t, address(usdt), address(0));
        assertEq(usdt.balanceOf(refundTo), 5e6);
    }

    function test_cloneAndImplementationLockedDown() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(0),
            1 ether,
            address(0),
            1 ether,
            0
        );

        address instance = deploy(t);

        vm.expectRevert(IGeneralErrors.OnlyFactory.selector);
        Kite(payable(instance)).settle();
        vm.expectRevert(IGeneralErrors.OnlyFactory.selector);
        Kite(payable(instance)).recover(address(0), address(0));

        vm.prank(address(factory));
        vm.expectRevert();
        Kite(payable(instance)).initialize();

        Kite implementation = Kite(payable(factory.implementation()));
        vm.prank(address(factory));
        vm.expectRevert();
        implementation.initialize();
    }

    function test_invalidConfigRejectedAtDeploy() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            0,
            1e6
        );

        vm.expectRevert(IGeneralErrors.InvalidConfig.selector);
        deploy(t);

        t = transfer(id(), address(usdc), 100e6, address(usdt), 99e6, 1e6);
        t.routerAddress = address(0);
        vm.expectRevert(IGeneralErrors.ZeroAddress.selector);
        deploy(t);
    }

    function test_operatorRoleManagedByAdmin() public {
        address newOperator = makeAddr("newOperator");
        bytes32 role = factory.OPERATOR_ROLE();
        vm.prank(admin);
        factory.grantRole(role, newOperator);
        vm.prank(admin);
        factory.revokeRole(role, operator);

        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            100e6,
            1e6
        );

        usdc.mint(factory.predictAddress(t), 100e6);

        vm.prank(operator);
        vm.expectRevert();
        factory.settle(t);
        vm.prank(newOperator);
        factory.settle(t);
    }

    function test_overpayErc20ExcessRefunded() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            100e6,
            1e6
        );

        address instance = factory.predictAddress(t);
        usdc.mint(instance, 130e6);

        vm.prank(operator);
        factory.settle(t);
        assertEq(usdc.balanceOf(merchant), 99e6);
        assertEq(usdc.balanceOf(feeTo), 1e6);
        assertEq(usdc.balanceOf(refundTo), 30e6);
        assertEq(usdc.balanceOf(instance), 0);
    }

    function test_overpayNativeExcessRefunded() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(0),
            1 ether,
            address(0),
            1 ether,
            0.01 ether
        );

        address instance = factory.predictAddress(t);
        vm.prank(payer);
        (bool ok, ) = instance.call{value: 1.4 ether}("");
        assertTrue(ok);

        vm.prank(operator);
        factory.settle(t);
        assertEq(refundTo.balance, 0.4 ether);
        assertEq(instance.balance, 0);
    }

    function test_overpayNativeToErc20SwapsExactAmountOnly() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(0),
            1 ether,
            address(usdc),
            2000e6,
            10e6
        );

        router.setRate(2500e6, 1 ether);
        address instance = factory.predictAddress(t);
        vm.prank(payer);
        (bool ok, ) = instance.call{value: 1.5 ether}("");
        assertTrue(ok);

        vm.prank(operator);
        factory.settle(t);
        assertEq(usdc.balanceOf(merchant) + usdc.balanceOf(feeTo), 2500e6);
        assertEq(refundTo.balance, 0.5 ether);
        assertEq(instance.balance, 0);
    }

    function test_overpayErc20ToErc20SwapsExactAmountOnly() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdt),
            99e6,
            1e6
        );

        router.setRate(1, 1);
        address instance = factory.predictAddress(t);
        usdc.mint(instance, 160e6);

        vm.prank(operator);
        factory.settle(t);
        assertEq(usdt.balanceOf(merchant) + usdt.balanceOf(feeTo), 100e6);
        assertEq(usdc.balanceOf(refundTo), 60e6);
        assertEq(usdc.balanceOf(instance), 0);
    }

    address feeTo2 = makeAddr("feeTo2");
    address feeTo3 = makeAddr("feeTo3");

    function fees3(
        uint256 first,
        uint256 second,
        uint256 third
    ) internal view returns (IFee.Fee[] memory fees) {
        fees = new IFee.Fee[](3);
        fees[0] = IFee.Fee(bytes32(uint256(1)), feeTo, first);
        fees[1] = IFee.Fee(bytes32(uint256(2)), feeTo2, second);
        fees[2] = IFee.Fee(bytes32(uint256(3)), feeTo3, third);
    }

    function test_multiFeeNativeToNative() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(0),
            1 ether,
            address(0),
            1 ether,
            0
        );

        t.fees = fees3(0.01 ether, 0.02 ether, 0.005 ether);
        address instance = deploy(t);

        vm.prank(payer);
        (bool ok, ) = instance.call{value: 1 ether}("");
        assertTrue(ok);

        vm.prank(operator);
        factory.settle(t);
        assertEq(feeTo.balance, 0.01 ether);
        assertEq(feeTo2.balance, 0.02 ether);
        assertEq(feeTo3.balance, 0.005 ether);
        assertEq(merchant.balance, 0.965 ether);
    }

    function test_multiFeeErc20SwapWithOverpay() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdt),
            95e6,
            0
        );

        t.fees = fees3(1e6, 2e6, 3e6);
        router.setRate(1, 1);
        address instance = factory.predictAddress(t);
        usdc.mint(instance, 110e6);

        vm.prank(operator);
        factory.settle(t);
        assertEq(usdt.balanceOf(feeTo), 1e6);
        assertEq(usdt.balanceOf(feeTo2), 2e6);
        assertEq(usdt.balanceOf(feeTo3), 3e6);
        assertEq(usdt.balanceOf(merchant), 94e6);
        assertEq(usdc.balanceOf(refundTo), 10e6);
    }

    function test_multiFeeSameRecipientTwiceIsFine() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            100e6,
            0
        );

        t.fees = new IFee.Fee[](2);
        t.fees[0] = IFee.Fee(bytes32(uint256(1)), feeTo, 1e6);
        t.fees[1] = IFee.Fee(bytes32(uint256(2)), feeTo, 2e6);
        usdc.mint(factory.predictAddress(t), 100e6);

        vm.prank(operator);
        factory.settle(t);
        assertEq(usdc.balanceOf(feeTo), 3e6);
        assertEq(usdc.balanceOf(merchant), 97e6);
    }

    function test_multiFeeTotalMustFitInMinAmountOut() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            5e6,
            0
        );

        t.fees = fees3(1e6, 2e6, 3e6);
        vm.expectRevert(IGeneralErrors.InvalidConfig.selector);
        deploy(t);
    }

    function test_multiFeeInvalidLinesRejected() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            100e6,
            0
        );

        t.fees = new IFee.Fee[](1);
        t.fees[0] = IFee.Fee(bytes32(uint256(1)), address(0), 1e6);
        vm.expectRevert(IGeneralErrors.ZeroAddress.selector);
        deploy(t);

        t.fees[0] = IFee.Fee(bytes32(uint256(1)), feeTo, 0);
        vm.expectRevert(IGeneralErrors.InvalidConfig.selector);
        deploy(t);
    }

    function test_multiFeeMaxIsTen() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            100e6,
            0
        );

        t.fees = new IFee.Fee[](11);
        for (uint256 i; i < 11; ++i) {
            t.fees[i] = IFee.Fee(bytes32(i), feeTo, 1);
        }

        vm.expectRevert(IGeneralErrors.TooManyFees.selector);
        deploy(t);

        t.fees = new IFee.Fee[](10);
        for (uint256 i; i < 10; ++i) {
            t.fees[i] = IFee.Fee(bytes32(i), feeTo, 1);
        }

        usdc.mint(factory.predictAddress(t), 100e6);
        vm.prank(operator);
        factory.settle(t);
        assertEq(usdc.balanceOf(feeTo), 10);
    }

    function test_differentParamsDifferentAddress() public {
        ITransfer.Transfer memory first = transfer(
            id(),
            address(0),
            1 ether,
            address(0),
            1 ether,
            0
        );

        ITransfer.Transfer memory second = transfer(
            first.id,
            address(0),
            1 ether,
            address(0),
            1 ether,
            0
        );

        second.settlementRecipient = payer;
        assertTrue(
            factory.predictAddress(first) != factory.predictAddress(second)
        );
    }

    function test_recoverToDestinationReportsDestination() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            100e6,
            1e6
        );

        address instance = factory.predictAddress(t);
        usdc.mint(instance, 100e6);

        vm.prank(operator);
        factory.settle(t);
        usdc.mint(instance, 7e6);

        address destination = makeAddr("destination");
        vm.expectEmit(true, true, true, true, instance);
        emit IKite.Recovered(t.id, address(usdc), destination, 7e6);

        vm.prank(operator);
        factory.recover(t, address(usdc), destination);
        assertEq(usdc.balanceOf(destination), 7e6);
        assertEq(usdc.balanceOf(refundTo), 0);
    }

    function test_overpaySettlesWhenRefundAddressRejectsEth() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(0),
            1 ether,
            address(0),
            1 ether,
            0.01 ether
        );

        // A contract without receive() rejects ETH.
        t.refundAddress = address(usdc);
        address instance = factory.predictAddress(t);

        vm.prank(payer);
        (bool ok, ) = instance.call{value: 1.4 ether}("");
        assertTrue(ok);

        vm.recordLogs();
        vm.prank(operator);
        factory.settle(t);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertNotEq(logs[i].topics[0], IKite.ExcessRefunded.selector);
        }

        assertEq(merchant.balance, 0.99 ether);
        assertEq(feeTo.balance, 0.01 ether);
        assertEq(instance.balance, 0.4 ether);

        address destination = makeAddr("destination");
        vm.prank(operator);
        factory.recover(t, address(0), destination);
        assertEq(destination.balance, 0.4 ether);
    }

    function test_refundToRejectingAddressClosesForRecovery() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(0),
            1 ether,
            address(0),
            1 ether,
            0
        );

        t.refundAddress = address(usdc);
        address instance = factory.predictAddress(t);
        vm.deal(instance, 1 ether);

        vm.expectEmit(true, true, true, true, instance);
        emit IKite.Refunded(t.id, address(usdc), address(0), 0);

        vm.prank(operator);
        factory.refund(t);

        assertEq(
            uint8(Kite(payable(instance)).status()),
            uint8(IKite.Status.Refunded)
        );
        assertEq(instance.balance, 1 ether);

        address destination = makeAddr("destination");
        vm.prank(operator);
        factory.recover(t, address(0), destination);
        assertEq(destination.balance, 1 ether);
    }

    function test_refundWithTooLittleGasReverts() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            100e6,
            1e6
        );

        address instance = factory.predictAddress(t);
        usdc.mint(instance, 100e6);
        deploy(t);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(payer);
        vm.expectRevert(IGeneralErrors.InsufficientGas.selector);
        Kite(payable(instance)).refund{gas: 90_000}();

        assertEq(
            uint8(Kite(payable(instance)).status()),
            uint8(IKite.Status.Open)
        );

        vm.prank(payer);
        Kite(payable(instance)).refund();
        assertEq(usdc.balanceOf(refundTo), 100e6);
    }

    function test_upgradeOnlyByProxyAdminOwnerAndKeepsState() public {
        KiteFactory next = new KiteFactory();
        address implementation = factory.implementation();
        bytes32 adminRole = factory.DEFAULT_ADMIN_ROLE();

        assertEq(proxyAdmin.owner(), admin);

        vm.expectRevert(
            abi.encodeWithSelector(
                Ownable.OwnableUnauthorizedAccount.selector,
                operator
            )
        );
        upgradeFactory(operator, address(next));

        upgradeFactory(admin, address(next));

        assertEq(proxySlot(ERC1967Utils.IMPLEMENTATION_SLOT), address(next));
        assertEq(factory.implementation(), implementation);
        assertTrue(factory.hasRole(adminRole, admin));
        assertTrue(factory.hasRole(factory.OPERATOR_ROLE(), operator));
    }

    function test_paymentsSurviveAFactoryUpgrade() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            100e6,
            1e6
        );

        address instance = factory.predictAddress(t);
        usdc.mint(instance, 100e6);

        upgradeFactory(admin, address(new KiteFactory()));

        assertEq(factory.predictAddress(t), instance);

        vm.prank(operator);
        factory.settle(t);

        assertEq(usdc.balanceOf(merchant), 99e6);
        assertEq(usdc.balanceOf(feeTo), 1e6);
    }

    function test_newImplementationOnlyForNewTransfers() public {
        ITransfer.Transfer memory existing = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            100e6,
            1e6
        );

        address existingInstance = factory.predictAddress(existing);
        usdc.mint(existingInstance, 100e6);

        Kite next = new Kite(address(factory));
        vm.prank(admin);
        factory.setImplementation(address(next));

        assertEq(factory.implementation(), address(next));
        assertTrue(factory.isImplementation(existing.implementation));
        assertEq(factory.predictAddress(existing), existingInstance);

        vm.prank(operator);
        factory.settle(existing);
        assertEq(usdc.balanceOf(merchant), 99e6);

        ITransfer.Transfer memory later = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            100e6,
            1e6
        );
        assertEq(later.implementation, address(next));

        usdc.mint(factory.predictAddress(later), 100e6);
        vm.prank(operator);
        factory.settle(later);
        assertEq(usdc.balanceOf(merchant), 198e6);
    }

    function test_setImplementationGuarded() public {
        Kite next = new Kite(address(factory));
        bytes32 adminRole = factory.DEFAULT_ADMIN_ROLE();

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                operator,
                adminRole
            )
        );
        factory.setImplementation(address(next));

        Kite foreign = new Kite(makeAddr("otherFactory"));
        vm.prank(admin);
        vm.expectRevert(IGeneralErrors.InvalidConfig.selector);
        factory.setImplementation(address(foreign));

        vm.prank(admin);
        vm.expectRevert(IGeneralErrors.InvalidConfig.selector);
        factory.setImplementation(makeAddr("noCode"));
    }

    function test_unknownImplementationRejected() public {
        ITransfer.Transfer memory t = transfer(
            id(),
            address(usdc),
            100e6,
            address(usdc),
            100e6,
            1e6
        );
        t.implementation = address(new Kite(address(factory)));

        vm.expectRevert(
            abi.encodeWithSelector(
                IGeneralErrors.UnknownImplementation.selector,
                t.implementation
            )
        );
        factory.predictAddress(t);

        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                IGeneralErrors.UnknownImplementation.selector,
                t.implementation
            )
        );
        factory.settle(t);
    }

    function test_factoryCannotBeInitializedAgain() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        factory.initialize(admin, operator);

        KiteFactory logic = new KiteFactory();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        logic.initialize(admin, operator);
    }
}
