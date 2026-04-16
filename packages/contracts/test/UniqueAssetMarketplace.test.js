const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("UniqueAssetMarketplace", function () {
  async function deployFixture() {
    const [owner, seller, buyer] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("UniqueAssetMarketplace");
    const marketplace = await factory.deploy();
    await marketplace.waitForDeployment();
    return { marketplace, owner, seller, buyer };
  }

  it("mints with unique file hash and transfers ownership after purchase", async function () {
    const { marketplace, seller, buyer } = await deployFixture();

    const metadataURI = "http://localhost:4000/metadata/hash.json";
    const fileHash = ethers.keccak256(ethers.toUtf8Bytes("file-a"));
    const price = ethers.parseEther("0.5");

    await marketplace.connect(seller).mintAsset(metadataURI, fileHash, "art");
    await marketplace.connect(seller).listToken(1, price);

    await expect(
      marketplace.connect(buyer).buyToken(1, { value: price })
    ).to.changeEtherBalances([buyer, seller], [price * -1n, price]);

    expect(await marketplace.ownerOf(1)).to.equal(buyer.address);

    const listing = await marketplace.getListing(1);
    expect(listing.active).to.equal(false);

    expect(await marketplace.tradeCount(1)).to.equal(1n);
  });

  it("rejects duplicate file hashes", async function () {
    const { marketplace, seller } = await deployFixture();

    const fileHash = ethers.keccak256(ethers.toUtf8Bytes("same-file"));

    await marketplace.connect(seller).mintAsset("uri-1", fileHash, "music");

    await expect(
      marketplace.connect(seller).mintAsset("uri-2", fileHash, "music")
    ).to.be.revertedWith("File hash already minted");
  });
});
