const { expect } = require("chai");
const { ethers } = require("hardhat");

async function mineSeconds(seconds) {
  const latest = await ethers.provider.getBlock("latest");
  await ethers.provider.send("evm_setNextBlockTimestamp", [latest.timestamp + seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function mineTo(ts) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
  await ethers.provider.send("evm_mine", []);
}

async function setNextTs(ts) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
}

describe("LPStaking", function () {
  it("rewards accrue over time and can be claimed", async function () {
    const [deployer, lp, trader] = await ethers.getSigners();

    // --- deploy tokens ---
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const tokenA = await MockERC20.deploy("Token A", "A", 18);
    const tokenB = await MockERC20.deploy("Token B", "B", 18);

    const RewardToken = await ethers.getContractFactory("RewardToken");
    const rwd = await RewardToken.deploy();

    // --- deploy factory + router ---
    const Factory = await ethers.getContractFactory("Factory");
    const factory = await Factory.deploy();

    const Router = await ethers.getContractFactory("Router");
    const router = await Router.deploy(await factory.getAddress());

    // --- add liquidity to create pair and mint LP to lp ---
    const amountA = ethers.parseUnits("1000", 18);
    const amountB = ethers.parseUnits("1000", 18);

    await tokenA.mint(lp.address, amountA);
    await tokenB.mint(lp.address, amountB);

    await tokenA.connect(lp).approve(await router.getAddress(), amountA);
    await tokenB.connect(lp).approve(await router.getAddress(), amountB);

    await router.connect(lp)[
      "addLiquidity(address,address,uint256,uint256,uint256,uint256,address)"
    ](
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      amountA,
      amountB,
      0,
      0,
      lp.address
    );

    const pairAddr = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
    const Pair = await ethers.getContractFactory("Pair");
    const pair = Pair.attach(pairAddr);

    const lpBalance = await pair.balanceOf(lp.address);
    expect(lpBalance).to.be.gt(0n);

    // --- deploy staking ---
    const rewardRate = ethers.parseUnits("1", 18); // 1 RWD / sec
    const LPStaking = await ethers.getContractFactory("LPStaking");
    const staking = await LPStaking.deploy(await pair.getAddress(), await rwd.getAddress(), rewardRate);

    // fund staking with RWD
    await rwd.mint(await staking.getAddress(), ethers.parseUnits("100000", 18));

    // lp approves and deposits LP
    await pair.connect(lp).approve(await staking.getAddress(), lpBalance);

    // 固定 deposit 的 timestamp，避免自动挖块+1 引入不确定
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const tDeposit = now + 10;
    await setNextTs(tDeposit);
    await staking.connect(lp).deposit(lpBalance);

    // 让时间来到 tDeposit + 10
    await mineTo(tDeposit + 10);

    // claim
    const before = await rwd.balanceOf(lp.address);
    await staking.connect(lp).claim();
    const after = await rwd.balanceOf(lp.address);

    expect(after - before).to.equal(ethers.parseUnits("10", 18));
  });

  it("splits rewards by stake share", async function () {
    const [deployer, alice, bob] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const tokenA = await MockERC20.deploy("Token A", "A", 18);
    const tokenB = await MockERC20.deploy("Token B", "B", 18);

    const RewardToken = await ethers.getContractFactory("RewardToken");
    const rwd = await RewardToken.deploy();

    const Factory = await ethers.getContractFactory("Factory");
    const factory = await Factory.deploy();

    const Router = await ethers.getContractFactory("Router");
    const router = await Router.deploy(await factory.getAddress());

    // create pair and mint LP to alice & bob by adding liquidity separately
    const amountA = ethers.parseUnits("1000", 18);
    const amountB = ethers.parseUnits("1000", 18);

    await tokenA.mint(alice.address, amountA);
    await tokenB.mint(alice.address, amountB);
    await tokenA.connect(alice).approve(await router.getAddress(), amountA);
    await tokenB.connect(alice).approve(await router.getAddress(), amountB);
    await router.connect(alice)[
      "addLiquidity(address,address,uint256,uint256,uint256,uint256,address)"
    ](await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB, 0, 0, alice.address);

    await tokenA.mint(bob.address, amountA);
    await tokenB.mint(bob.address, amountB);
    await tokenA.connect(bob).approve(await router.getAddress(), amountA);
    await tokenB.connect(bob).approve(await router.getAddress(), amountB);
    await router.connect(bob)[
      "addLiquidity(address,address,uint256,uint256,uint256,uint256,address)"
    ](await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB, 0, 0, bob.address);

    const pairAddr = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
    const Pair = await ethers.getContractFactory("Pair");
    const pair = Pair.attach(pairAddr);

    const aliceLP = await pair.balanceOf(alice.address);
    const bobLP = await pair.balanceOf(bob.address);

    // bob stakes only half of his LP (for clear ratio)
    const bobStake = bobLP / 2n;

    const rewardRate = ethers.parseUnits("1", 18); // 1 RWD / sec total
    const LPStaking = await ethers.getContractFactory("LPStaking");
    const staking = await LPStaking.deploy(await pair.getAddress(), await rwd.getAddress(), rewardRate);
    await rwd.mint(await staking.getAddress(), ethers.parseUnits("100000", 18));

    await pair.connect(alice).approve(await staking.getAddress(), aliceLP);
    await pair.connect(bob).approve(await staking.getAddress(), bobStake);

    // ----------------------------
    // 关键：固定时间线 + 同一时刻读 pendingRewards（不再用 claim 的钱包余额对 total）
    // ----------------------------
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const base = now + 10;

    // alice deposit at base
    await setNextTs(base);
    await staking.connect(alice).deposit(aliceLP);

    // bob deposit at base+1（hardhat 不能同 timestamp）
    await setNextTs(base + 1);
    await staking.connect(bob).deposit(bobStake);

    // 共同统计窗口：从 base+1 到 end 一共 10 秒
    const end = base + 1 + 10;
    await mineTo(end);

    // 同一 timestamp 下读取 pending（view 不挖块，不会产生“不同截止时间”）
    const alicePending = await staking.pendingRewards(alice.address);
    const bobPending = await staking.pendingRewards(bob.address);

    // ----------------------------
    // 正确期望：分段计算
    // 段1: [base, base+1) 只有 alice => 1 秒奖励全给 alice
    // 段2: [base+1, end) 两人 => 10 秒奖励按份额分
    // ----------------------------
    const seg1 = rewardRate * 1n;   // 1s
    const seg2 = rewardRate * 10n;  // 10s

    const aliceStake = aliceLP;
    const bobStake2 = bobStake;
    const sumStake = aliceStake + bobStake2;

    const seg2Alice = (seg2 * aliceStake) / sumStake;
    const seg2Bob = seg2 - seg2Alice;

    const expectedAlice = seg1 + seg2Alice;
    const expectedBob = seg2Bob;

    // wei 级取整误差容忍
    const eps = 2_000_000_000n; // 2e9 wei ~ 2 gwei
   


    expect(alicePending).to.be.gt(bobPending);
    expect(alicePending >= expectedAlice - eps && alicePending <= expectedAlice + eps).to.equal(true);
    expect(bobPending >= expectedBob - eps && bobPending <= expectedBob + eps).to.equal(true);
  });
});
