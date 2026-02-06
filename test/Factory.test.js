const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Factory", function () {
  async function deployFixture() {
    const [deployer] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const tokenA = await MockERC20.deploy("TokenA", "TKA", 18);
    const tokenB = await MockERC20.deploy("TokenB", "TKB", 18);

    const Factory = await ethers.getContractFactory("Factory");
    const factory = await Factory.deploy();

    return { factory, tokenA, tokenB };
  }

  it("creates a pair", async function () {
    const { factory, tokenA, tokenB } = await deployFixture();

    const tx = await factory.createPair(tokenA.target, tokenB.target);
    const receipt = await tx.wait();

    const pairAddress = await factory.getPair(
      tokenA.target,
      tokenB.target
    );

    expect(pairAddress).to.not.equal(ethers.ZeroAddress);
    expect(await factory.allPairsLength()).to.equal(1);
  });

  it("reverts on duplicate pair", async function () {
    const { factory, tokenA, tokenB } = await deployFixture();

    await factory.createPair(tokenA.target, tokenB.target);

    await expect(
      factory.createPair(tokenB.target, tokenA.target)
    ).to.be.revertedWith("PAIR_EXISTS");
  });

  it("stores token0 and token1 sorted", async function () {
    const { factory, tokenA, tokenB } = await deployFixture();

    await factory.createPair(tokenA.target, tokenB.target);
    const pairAddress = await factory.getPair(
      tokenA.target,
      tokenB.target
    );

    const Pair = await ethers.getContractFactory("Pair");
    const pair = Pair.attach(pairAddress);

    const t0 = await pair.token0();
    const t1 = await pair.token1();

    expect(t0 < t1).to.equal(true);
  });
});
