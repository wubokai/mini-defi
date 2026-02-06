const { expect } = require("chai");
const { ethers } = require("hardhat");

async function setNextTs(ts) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
}

async function mineTo(ts) {
  await setNextTs(ts);
  await ethers.provider.send("evm_mine", []);
}

describe("MultiLPStaking (MasterChef-lite, multi-pool)", function () {
  it("startTime works: pending is 0 before start, accrues after start", async function () {
    const [owner, alice] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const RewardToken = await ethers.getContractFactory("RewardToken");
    const MultiLPStaking = await ethers.getContractFactory("MultiLPStaking");

    const lp = await MockERC20.deploy("LP", "LP", 18);
    const rwd = await RewardToken.deploy();

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const start = now + 100;
    const rps = ethers.parseUnits("1", 18);

    const chef = await MultiLPStaking.deploy(await rwd.getAddress(), rps, start);

    // fund rewards (RewardToken mint onlyOwner: owner is deployer)
    await rwd.mint(await chef.getAddress(), ethers.parseUnits("100000", 18));

    await chef.addPool(100, await lp.getAddress(), false);

    const stake = ethers.parseUnits("100", 18);
    await lp.mint(alice.address, stake);
    await lp.connect(alice).approve(await chef.getAddress(), stake);

    // deposit before start
    await chef.connect(alice).deposit(0, stake);

    // before start: pending = 0
    await mineTo(start - 10);
    expect(await chef.pendingRewards(0, alice.address)).to.equal(0n);

    // after start: pending > 0
    await mineTo(start + 10);
    const p = await chef.pendingRewards(0, alice.address);
    expect(p).to.be.gt(0n);

    // should be ~10 RWD
    const eps = 2_000_000_000n; // gwei-level rounding tolerance
    const expected = ethers.parseUnits("10", 18);
    expect(p >= expected - eps && p <= expected + eps).to.equal(true);
  });

  it("distributes rewards across pools by allocPoint and within pool by stake share", async function () {
    const [owner, alice, bob] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const RewardToken = await ethers.getContractFactory("RewardToken");
    const MultiLPStaking = await ethers.getContractFactory("MultiLPStaking");

    const lp0 = await MockERC20.deploy("LP0", "LP0", 18);
    const lp1 = await MockERC20.deploy("LP1", "LP1", 18);
    const rwd = await RewardToken.deploy();

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const start = now + 50;
    const rps = ethers.parseUnits("1", 18); // 1 RWD/sec total

    const chef = await MultiLPStaking.deploy(await rwd.getAddress(), rps, start);
    await rwd.mint(await chef.getAddress(), ethers.parseUnits("100000", 18));

    // alloc 100 / 300 => pool0 25%, pool1 75%
    await chef.addPool(100, await lp0.getAddress(), false);
    await chef.addPool(300, await lp1.getAddress(), false);

    const a0 = ethers.parseUnits("100", 18);
    const b0 = ethers.parseUnits("100", 18);
    const a1 = ethers.parseUnits("200", 18);

    await lp0.mint(alice.address, a0);
    await lp0.mint(bob.address, b0);
    await lp1.mint(alice.address, a1);

    await lp0.connect(alice).approve(await chef.getAddress(), a0);
    await lp0.connect(bob).approve(await chef.getAddress(), b0);
    await lp1.connect(alice).approve(await chef.getAddress(), a1);

    // deposit (same timestamp is allowed in your hardhat config)
    await setNextTs(start - 20);
    await chef.connect(alice).deposit(0, a0);
    await chef.connect(bob).deposit(0, b0);
    await chef.connect(alice).deposit(1, a1);

    // move to start + 20s
    await mineTo(start + 20);

    const aliceP0 = await chef.pendingRewards(0, alice.address);
    const bobP0 = await chef.pendingRewards(0, bob.address);
    const aliceP1 = await chef.pendingRewards(1, alice.address);

    // total emitted: 20 RWD
    // pool0: 20 * 100/400 = 5 RWD, split 50/50 => 2.5 each
    // pool1: 20 * 300/400 = 15 RWD, only alice => 15
    const eps = 2_000_000_000n;

    const expectedPool0 = ethers.parseUnits("5", 18);
    const expectedAliceP0 = expectedPool0 / 2n;
    const expectedBobP0 = expectedPool0 - expectedAliceP0;

    const expectedAliceP1 = ethers.parseUnits("15", 18);

    expect(aliceP0 >= expectedAliceP0 - eps && aliceP0 <= expectedAliceP0 + eps).to.equal(true);
    expect(bobP0 >= expectedBobP0 - eps && bobP0 <= expectedBobP0 + eps).to.equal(true);
    expect(aliceP1 >= expectedAliceP1 - eps && aliceP1 <= expectedAliceP1 + eps).to.equal(true);
  });

  it("changing allocPoint only affects future rewards when withUpdate=true", async function () {
    const [owner, alice] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const RewardToken = await ethers.getContractFactory("RewardToken");
    const MultiLPStaking = await ethers.getContractFactory("MultiLPStaking");

    const lp0 = await MockERC20.deploy("LP0", "LP0", 18);
    const lp1 = await MockERC20.deploy("LP1", "LP1", 18);
    const rwd = await RewardToken.deploy();

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const start = now + 50;
    const rps = ethers.parseUnits("1", 18);

    const chef = await MultiLPStaking.deploy(await rwd.getAddress(), rps, start);
    await rwd.mint(await chef.getAddress(), ethers.parseUnits("100000", 18));

    await chef.addPool(100, await lp0.getAddress(), false);
    await chef.addPool(100, await lp1.getAddress(), false);

    const amt = ethers.parseUnits("100", 18);
    await lp0.mint(alice.address, amt);
    await lp1.mint(alice.address, amt);
    await lp0.connect(alice).approve(await chef.getAddress(), amt);
    await lp1.connect(alice).approve(await chef.getAddress(), amt);

    await setNextTs(start - 20);
    await chef.connect(alice).deposit(0, amt);
    await chef.connect(alice).deposit(1, amt);

    // after 10s from start: each pool gets 5 RWD
    await mineTo(start + 10);
    const p0_before = await chef.pendingRewards(0, alice.address);
    const p1_before = await chef.pendingRewards(1, alice.address);

    // set pool0 alloc to 300 (pool1 stays 100), withUpdate=true locks in the past
    await chef.setPool(0, 300, true);

    // another 10s: total 10 RWD, pool0 gets 7.5, pool1 gets 2.5
    await mineTo(start + 20);
    const p0_after = await chef.pendingRewards(0, alice.address);
    const p1_after = await chef.pendingRewards(1, alice.address);

    const eps = 2_000_000_000n;

    const expectedBefore = ethers.parseUnits("5", 18);
    expect(p0_before >= expectedBefore - eps && p0_before <= expectedBefore + eps).to.equal(true);
    expect(p1_before >= expectedBefore - eps && p1_before <= expectedBefore + eps).to.equal(true);

    const expectedP0After = ethers.parseUnits("12.5", 18); // 5 + 7.5
    const expectedP1After = ethers.parseUnits("7.5", 18);  // 5 + 2.5
    expect(p0_after >= expectedP0After - eps && p0_after <= expectedP0After + eps).to.equal(true);
    expect(p1_after >= expectedP1After - eps && p1_after <= expectedP1After + eps).to.equal(true);
  });

  it("harvest pays what it can when reward balance is insufficient (no revert)", async function () {
    const [owner, alice] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const RewardToken = await ethers.getContractFactory("RewardToken");
    const MultiLPStaking = await ethers.getContractFactory("MultiLPStaking");

    const lp = await MockERC20.deploy("LP", "LP", 18);
    const rwd = await RewardToken.deploy();

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const start = now + 30;
    const rps = ethers.parseUnits("10", 18); // 10/sec

    const chef = await MultiLPStaking.deploy(await rwd.getAddress(), rps, start);

    // only fund 15 RWD, but 2 seconds should produce 20 RWD
    await rwd.mint(await chef.getAddress(), ethers.parseUnits("15", 18));

    await chef.addPool(100, await lp.getAddress(), false);

    const stake = ethers.parseUnits("100", 18);
    await lp.mint(alice.address, stake);
    await lp.connect(alice).approve(await chef.getAddress(), stake);

    await setNextTs(start - 10);
    await chef.connect(alice).deposit(0, stake);

    await mineTo(start + 2);

    const before = await rwd.balanceOf(alice.address);
    await chef.connect(alice).harvest(0);
    const after = await rwd.balanceOf(alice.address);

    // should receive <= 15 (all balance drained), and not revert
    expect(after - before).to.equal(ethers.parseUnits("15", 18));
  });
});
