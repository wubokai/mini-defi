const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Router removeLiquidity", function () {
  async function deploy() {
    const [deployer, lp] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const tokenA = await Token.deploy("TokenA", "A", 18);
    const tokenB = await Token.deploy("TokenB", "B", 18);

    const Factory = await ethers.getContractFactory("Factory");
    const factory = await Factory.deploy();

    const Router = await ethers.getContractFactory("Router");
    const router = await Router.deploy(await factory.getAddress());

    return { deployer, lp, tokenA, tokenB, factory, router };
  }

  it("add then remove liquidity returns tokens", async function () {
    const { lp, tokenA, tokenB, factory, router } = await deploy();

    // mint to lp
    await tokenA.mint(lp.address, ethers.parseUnits("1000", 18));
    await tokenB.mint(lp.address, ethers.parseUnits("1000", 18));

    // approve router for tokens
    await tokenA.connect(lp).approve(await router.getAddress(), ethers.parseUnits("1000", 18));
    await tokenB.connect(lp).approve(await router.getAddress(), ethers.parseUnits("1000", 18));

    // add liquidity
    await router.connect(lp).addLiquidity(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      ethers.parseUnits("100", 18),
      ethers.parseUnits("100", 18),
      0,
      0,
      lp.address
    );

    const pairAddr = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
    const Pair = await ethers.getContractFactory("Pair");
    const pair = Pair.attach(pairAddr);

    // approve router for LP token (pair is ERC20)
    await pair.connect(lp).approve(await router.getAddress(), ethers.parseUnits("50", 18));

    const aBefore = await tokenA.balanceOf(lp.address);
    const bBefore = await tokenB.balanceOf(lp.address);

    // remove half liquidity
    await router.connect(lp).removeLiquidity(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      ethers.parseUnits("50", 18),
      0,
      0,
      lp.address
    );

    const aAfter = await tokenA.balanceOf(lp.address);
    const bAfter = await tokenB.balanceOf(lp.address);

    expect(aAfter).to.be.gt(aBefore);
    expect(bAfter).to.be.gt(bBefore);
  });
});
