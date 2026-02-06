const { ethers } = require("hardhat");

async function main() {
  const [deployer, lp, trader] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("MockERC20");
  const tokenA = await Token.deploy("TokenA", "A", 18);
  const tokenB = await Token.deploy("TokenB", "B", 18);

  const Factory = await ethers.getContractFactory("Factory");
  const factory = await Factory.deploy();

  const Router = await ethers.getContractFactory("Router");
  const router = await Router.deploy(await factory.getAddress());

  const A = await tokenA.getAddress();
  const B = await tokenB.getAddress();
  const R = await router.getAddress();

  // LP add liquidity
  await tokenA.mint(lp.address, ethers.parseUnits("1000", 18));
  await tokenB.mint(lp.address, ethers.parseUnits("1000", 18));
  await tokenA.connect(lp).approve(R, ethers.parseUnits("1000", 18));
  await tokenB.connect(lp).approve(R, ethers.parseUnits("1000", 18));

  console.log("LP before:", String(await tokenA.balanceOf(lp.address)), String(await tokenB.balanceOf(lp.address)));

  await router.connect(lp).addLiquidity(A, B,
    ethers.parseUnits("100", 18),
    ethers.parseUnits("100", 18),
    0, 0, lp.address
  );

  const pairAddr = await factory.getPair(A, B);
  const Pair = await ethers.getContractFactory("Pair");
  const pair = Pair.attach(pairAddr);

  console.log("Pair:", pairAddr);
  console.log("LP token:", String(await pair.balanceOf(lp.address)));

  // Trader swap
  await tokenA.mint(trader.address, ethers.parseUnits("10", 18));
  await tokenA.connect(trader).approve(R, ethers.parseUnits("10", 18));

  console.log("Trader before:", String(await tokenA.balanceOf(trader.address)), String(await tokenB.balanceOf(trader.address)));

  const deadline = (await ethers.provider.getBlock("latest")).timestamp + 60;
  const amountIn = ethers.parseUnits("10", 18);
  await router["swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"](
    amountIn,
    0,
    path,
    trader.address,
    deadline
  );


  console.log("Trader after:", String(await tokenA.balanceOf(trader.address)), String(await tokenB.balanceOf(trader.address)));

  // LP remove liquidity
  await pair.connect(lp).approve(R, ethers.parseUnits("50", 18));
  await router.connect(lp).removeLiquidity(A, B, ethers.parseUnits("50", 18), 0, 0, lp.address);

  console.log("LP after remove:", String(await tokenA.balanceOf(lp.address)), String(await tokenB.balanceOf(lp.address)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
