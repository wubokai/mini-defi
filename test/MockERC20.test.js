const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MockERC20", function () {
  it("mints and transfers correctly", async function () {
    const [alice, bob] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("TokenA", "TKA", 18);

    await token.mint(alice.address, ethers.parseEther("100"));
    expect(await token.balanceOf(alice.address)).to.equal(
      ethers.parseEther("100")
    );

    await token.connect(alice).transfer(bob.address, ethers.parseEther("1"));
    expect(await token.balanceOf(bob.address)).to.equal(
      ethers.parseEther("1")
    );
  });

  it("supports custom decimals", async function () {
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

    expect(await usdc.decimals()).to.equal(6);
  });
});
