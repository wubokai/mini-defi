const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Router", function () {
  async function deploy() {
    const [deployer, lp, trader] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const tokenA = await Token.deploy("TokenA", "A", 18);
    const tokenB = await Token.deploy("TokenB", "B", 18);

    const Factory = await ethers.getContractFactory("Factory");
    const factory = await Factory.deploy();

    const Router = await ethers.getContractFactory("Router");
    const router = await Router.deploy(await factory.getAddress());

    return { deployer, lp, trader, tokenA, tokenB, factory, router };
  }

  it("addLiquidity creates pair and mints LP", async function () {
    const { lp, tokenA, tokenB, factory, router } = await deploy();

    // mint tokens to lp
    await tokenA.mint(lp.address, ethers.parseUnits("1000", 18));
    await tokenB.mint(lp.address, ethers.parseUnits("1000", 18));

    // approve router
    await tokenA.connect(lp).approve(await router.getAddress(), ethers.parseUnits("1000", 18));
    await tokenB.connect(lp).approve(await router.getAddress(), ethers.parseUnits("1000", 18));

    // add liquidity via router
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
    expect(pairAddr).to.not.equal(ethers.ZeroAddress);

    const Pair = await ethers.getContractFactory("Pair");
    const pair = Pair.attach(pairAddr);

    // LP token supply should be 100e18 (sqrt(100*100)=100)
    expect(await pair.totalSupply()).to.equal(ethers.parseUnits("100", 18));
    expect(await pair.balanceOf(lp.address)).to.equal(ethers.parseUnits("100", 18));
  });

  it("swapExactTokensForTokens works (single hop)", async function () {
    const { lp, trader, tokenA, tokenB, factory, router } = await deploy();

    // LP add liquidity first
    await tokenA.mint(lp.address, ethers.parseUnits("1000", 18));
    await tokenB.mint(lp.address, ethers.parseUnits("1000", 18));
    await tokenA.connect(lp).approve(await router.getAddress(), ethers.parseUnits("1000", 18));
    await tokenB.connect(lp).approve(await router.getAddress(), ethers.parseUnits("1000", 18));

    await router.connect(lp).addLiquidity(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      ethers.parseUnits("100", 18),
      ethers.parseUnits("100", 18),
      0,
      0,
      lp.address
    );

    // trader swap 10 A -> B
    await tokenA.mint(trader.address, ethers.parseUnits("10", 18));
    await tokenA.connect(trader).approve(await router.getAddress(), ethers.parseUnits("10", 18));

    const amountIn = ethers.parseUnits("10", 18);
    const path = [await tokenA.getAddress(), await tokenB.getAddress()];
    const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;

    await router.connect(trader)["swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"](
      amountIn,
      0,
      path,
      trader.address,
      deadline
    );


    const bBal = await tokenB.balanceOf(trader.address);
    expect(bBal).to.be.gt(0n);

    // pair exists
    const pairAddr = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
    expect(pairAddr).to.not.equal(ethers.ZeroAddress);
  });
});
