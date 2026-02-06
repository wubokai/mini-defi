const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Router multihop swap", function () {
  async function deploy() {
    const [lp, trader] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const tokenA = await Token.deploy("TokenA", "A", 18);
    const tokenB = await Token.deploy("TokenB", "B", 18);
    const tokenC = await Token.deploy("TokenC", "C", 18);

    const Factory = await ethers.getContractFactory("Factory");
    const factory = await Factory.deploy();

    const Router = await ethers.getContractFactory("Router");
    const router = await Router.deploy(await factory.getAddress());

    // LP mint
    await tokenA.mint(lp.address, ethers.parseUnits("1000", 18));
    await tokenB.mint(lp.address, ethers.parseUnits("1000", 18));
    await tokenC.mint(lp.address, ethers.parseUnits("1000", 18));

    await tokenA.connect(lp).approve(await router.getAddress(), ethers.parseUnits("1000", 18));
    await tokenB.connect(lp).approve(await router.getAddress(), ethers.parseUnits("1000", 18));
    await tokenC.connect(lp).approve(await router.getAddress(), ethers.parseUnits("1000", 18));

    // pools: A-B and B-C
    await router.connect(lp).addLiquidity(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      ethers.parseUnits("100", 18),
      ethers.parseUnits("100", 18),
      0, 0,
      lp.address
    );

    await router.connect(lp).addLiquidity(
      await tokenB.getAddress(),
      await tokenC.getAddress(),
      ethers.parseUnits("100", 18),
      ethers.parseUnits("100", 18),
      0, 0,
      lp.address
    );

    return { lp, trader, tokenA, tokenB, tokenC, factory, router };
  }

  it("swaps A -> C through B", async function () {
    const { trader, tokenA, tokenB, tokenC, router } = await deploy();

    await tokenA.mint(trader.address, ethers.parseUnits("10", 18));
    await tokenA.connect(trader).approve(await router.getAddress(), ethers.parseUnits("10", 18));

    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

    const path = [await tokenA.getAddress(), await tokenB.getAddress(), await tokenC.getAddress()];

    const cBefore = await tokenC.balanceOf(trader.address);

    await router.connect(trader).swapExactTokensForTokens(
      ethers.parseUnits("10", 18),
      0,
      path,
      trader.address,
      deadline
    );

    const cAfter = await tokenC.balanceOf(trader.address);
    expect(cAfter).to.be.gt(cBefore);
  });
});
