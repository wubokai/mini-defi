const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Pair swap", function () {
  async function deploy() {
    const [lp, trader] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const tokenA = await Token.deploy("TokenA", "A", 18);
    const tokenB = await Token.deploy("TokenB", "B", 18);

    const Pair = await ethers.getContractFactory("Pair");
    const pair = await Pair.deploy(
      await tokenA.getAddress(),
      await tokenB.getAddress()
    );

    const p = await pair.getAddress();

    return { lp, trader, tokenA, tokenB, pair, p };
  }

  it("swaps tokenA for tokenB with fee", async function () {
    const { lp, trader, tokenA, tokenB, pair, p } = await deploy();

    // LP adds 100A / 100B
    await tokenA.mint(lp.address, ethers.parseUnits("1000", 18));
    await tokenB.mint(lp.address, ethers.parseUnits("1000", 18));

    await tokenA.transfer(p, ethers.parseUnits("100", 18));
    await tokenB.transfer(p, ethers.parseUnits("100", 18));
    await pair.mint(lp.address);

    // trader swaps 10 A -> B
    await tokenA.mint(trader.address, ethers.parseUnits("10", 18));
    await tokenA.connect(trader).transfer(p, ethers.parseUnits("10", 18));

    // expected B out ≈ 9.066 (with 0.3% fee)
    await pair.connect(trader).swap(
      0,
      ethers.parseUnits("9", 18),
      trader.address
    );

    const bBal = await tokenB.balanceOf(trader.address);
    expect(bBal).to.be.gte(ethers.parseUnits("9", 18));

    const [r0, r1] = await pair.getReserves();
    expect(r0).to.be.gt(ethers.parseUnits("100", 18)); // fee stays
    expect(r1).to.be.lt(ethers.parseUnits("100", 18));
  });

  it("reverts if k decreases", async function () {
    const { lp, trader, tokenA, tokenB, pair, p } = await deploy();

    await tokenA.mint(lp.address, ethers.parseUnits("100", 18));
    await tokenB.mint(lp.address, ethers.parseUnits("100", 18));

    await tokenA.transfer(p, ethers.parseUnits("100", 18));
    await tokenB.transfer(p, ethers.parseUnits("100", 18));
    await pair.mint(lp.address);

    await tokenA.mint(trader.address, ethers.parseUnits("10", 18));
    await tokenA.connect(trader).transfer(p, ethers.parseUnits("10", 18));

    // try to take too much B
    await expect(
      pair.connect(trader).swap(
        0,
        ethers.parseUnits("20", 18),
        trader.address
      )
    ).to.be.revertedWith("K");
  });
});
