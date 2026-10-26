import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("KiteFactoryModule", (m) => {
  const deployer = m.getAccount(0);
  const admin = m.getParameter("admin", deployer);
  const operator = m.getParameter("operator");

  const KiteFactory = m.contract("KiteFactory");
  const TransparentUpgradeableProxy = m.contract(
    "TransparentUpgradeableProxy",
    [
      KiteFactory,
      deployer,
      m.encodeFunctionCall(KiteFactory, "initialize", [admin, operator]),
    ],
  );

  const ProxyAdmin = m.contractAt(
    "ProxyAdmin",
    m.readEventArgument(
      TransparentUpgradeableProxy,
      "AdminChanged",
      "newAdmin",
    ),
  );

  const KiteFactoryProxy = m.contractAt(
    "KiteFactory",
    TransparentUpgradeableProxy,
    { id: "KiteFactoryProxy" },
  );

  return { KiteFactoryProxy, ProxyAdmin };
});
