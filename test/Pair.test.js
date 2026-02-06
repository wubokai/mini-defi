const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Pair (LP token)", function () {
  it("has correct name and symbol", async function () {
    const Token = await ethers.getContractFactory("MockERC20");
    const tokenA = await Token.deploy("TokenA", "A", 18);
    const tokenB = await Token.deploy("TokenB", "B", 18);

    const a = await tokenA.getAddress();
    const b = await tokenB.getAddress();

    const Pair = await ethers.getContractFactory("Pair");
    const pair = await Pair.deploy(a, b);

    expect(await pair.name()).to.equal("MiniSwap LP");
    expect(await pair.symbol()).to.equal("MSLP");
    expect(await pair.token0()).to.equal(a);
    expect(await pair.token1()).to.equal(b);
  });
});
