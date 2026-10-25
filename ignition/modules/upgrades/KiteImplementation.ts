import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("KiteImplementationModule", (m) => {
  const factory = m.getParameter("factory");

  const KiteFactory = m.contractAt("KiteFactory", factory);
  const Kite = m.contract("Kite", [factory]);

  m.call(KiteFactory, "setImplementation", [Kite]);

  return { Kite, KiteFactory };
});
