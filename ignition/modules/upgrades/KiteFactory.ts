import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("KiteFactoryUpgradeModule", (m) => {
  const proxyAdminAddress = m.getParameter("proxyAdmin");
  const ProxyAdmin = m.contractAt("ProxyAdmin", proxyAdminAddress);
  const KiteFactory = m.contract("KiteFactory");

  m.call(ProxyAdmin, "upgradeAndCall", [
    m.getParameter("factory"),
    KiteFactory,
    "0x",
  ]);

  return { ProxyAdmin };
});
