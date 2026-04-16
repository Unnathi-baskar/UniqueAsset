const hre = require("hardhat");

async function main() {
  const marketplaceFactory = await hre.ethers.getContractFactory("UniqueAssetMarketplace");
  const marketplace = await marketplaceFactory.deploy();

  await marketplace.waitForDeployment();

  const deployedAddress = await marketplace.getAddress();
  console.log("UniqueAssetMarketplace deployed to:", deployedAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
