import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("KiteFactoryModule", (m) => {
  const admin = m.getParameter("admin");
  const operator = m.getParameter("operator");

  const KiteFactory = m.contract("KiteFactory", [admin, operator]);

  return { KiteFactory };
});
