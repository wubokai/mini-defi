const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Pair liquidity (mint/burn)", function () {
  async function deploy() {
    const [lpProvider, other] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const tokenA = await Token.deploy("TokenA", "A", 18);
    const tokenB = await Token.deploy("TokenB", "B", 18);

    const a = await tokenA.getAddress();
    const b = await tokenB.getAddress();

    const Pair = await ethers.getContractFactory("Pair");
    const pair = await Pair.deploy(a, b);
    const p = await pair.getAddress();

    return { lpProvider, other, tokenA, tokenB, pair, a, b, p };
  }

  it("mints initial liquidity = sqrt(amount0 * amount1)", async function () {
    const { lpProvider, tokenA, tokenB, pair, p } = await deploy();

    // mint tokens to LP provider
    await tokenA.mint(lpProvider.address, ethers.parseUnits("1000", 18));
    await tokenB.mint(lpProvider.address, ethers.parseUnits("1000", 18));

    // transfer into pair
    await tokenA.connect(lpProvider).transfer(p, ethers.parseUnits("100", 18));
    await tokenB.connect(lpProvider).transfer(p, ethers.parseUnits("100", 18));

    // mint LP
    await pair.connect(lpProvider).mint(lpProvider.address);

    const totalSupply = await pair.totalSupply();
    // sqrt(100*100) = 100 (in 18 decimals both, amounts are 100e18 => sqrt(1e40)=1e20)
    // so expected is 100e18
    expect(totalSupply).to.equal(ethers.parseUnits("100", 18));

    const [r0, r1] = await pair.getReserves();
    expect(r0).to.equal(ethers.parseUnits("100", 18));
    expect(r1).to.equal(ethers.parseUnits("100", 18));
  });

  it("mints subsequent liquidity proportional (no dilution)", async function () {
    const { lpProvider, tokenA, tokenB, pair, p } = await deploy();

    await tokenA.mint(lpProvider.address, ethers.parseUnits("1000", 18));
    await tokenB.mint(lpProvider.address, ethers.parseUnits("1000", 18));

    // initial 100/100
    await tokenA.connect(lpProvider).transfer(p, ethers.parseUnits("100", 18));
    await tokenB.connect(lpProvider).transfer(p, ethers.parseUnits("100", 18));
    await pair.connect(lpProvider).mint(lpProvider.address);

    // add 50/50 => should mint 50 LP
    await tokenA.connect(lpProvider).transfer(p, ethers.parseUnits("50", 18));
    await tokenB.connect(lpProvider).transfer(p, ethers.parseUnits("50", 18));
    await pair.connect(lpProvider).mint(lpProvider.address);

    expect(await pair.totalSupply()).to.equal(ethers.parseUnits("150", 18));

    const [r0, r1] = await pair.getReserves();
    expect(r0).to.equal(ethers.parseUnits("150", 18));
    expect(r1).to.equal(ethers.parseUnits("150", 18));
  });

  it("burn returns tokens proportional to LP share", async function () {
    const { lpProvider, tokenA, tokenB, pair, p } = await deploy();

    await tokenA.mint(lpProvider.address, ethers.parseUnits("1000", 18));
    await tokenB.mint(lpProvider.address, ethers.parseUnits("1000", 18));

    // add 100/100 => 100 LP
    await tokenA.connect(lpProvider).transfer(p, ethers.parseUnits("100", 18));
    await tokenB.connect(lpProvider).transfer(p, ethers.parseUnits("100", 18));
    await pair.connect(lpProvider).mint(lpProvider.address);

    // send 40 LP back to pair then burn
    await pair.connect(lpProvider).transfer(p, ethers.parseUnits("40", 18));
    await pair.connect(lpProvider).burn(lpProvider.address);

    // provider should receive 40/40 back
    // initial balances: 1000 minted; sent 100 to pair => 900 left
    // after burn receive 40 => 940
    expect(await tokenA.balanceOf(lpProvider.address)).to.equal(ethers.parseUnits("940", 18));
    expect(await tokenB.balanceOf(lpProvider.address)).to.equal(ethers.parseUnits("940", 18));

    // reserves should be 60/60
    const [r0, r1] = await pair.getReserves();
    expect(r0).to.equal(ethers.parseUnits("60", 18));
    expect(r1).to.equal(ethers.parseUnits("60", 18));

    // totalSupply should be 60 LP
    expect(await pair.totalSupply()).to.equal(ethers.parseUnits("60", 18));
  });
});
