/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

function addr(x) {
  return typeof x === "string" ? x : x?.target ?? x?.address;
}

async function main() {
  const { ethers, network } = hre;
  const [deployer, alice, bob] = await ethers.getSigners();

  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);

  // -------------------------
  // Deploy core tokens
  // -------------------------
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const RewardToken = await ethers.getContractFactory("RewardToken");

  const tokenA = await MockERC20.deploy("TokenA", "TKA", 18);
  const tokenB = await MockERC20.deploy("TokenB", "TKB", 18);
  const tokenC = await MockERC20.deploy("TokenC", "TKC", 18);
  const tokenD = await MockERC20.deploy("TokenD", "TKD", 18);

  const reward = await RewardToken.deploy();

  await tokenA.waitForDeployment();
  await tokenB.waitForDeployment();
  await tokenC.waitForDeployment();
  await tokenD.waitForDeployment();
  await reward.waitForDeployment();

  console.log("tokenA:", addr(tokenA));
  console.log("tokenB:", addr(tokenB));
  console.log("tokenC:", addr(tokenC));
  console.log("tokenD:", addr(tokenD));
  console.log("reward:", addr(reward));

  // -------------------------
  // Deploy DEX: Factory + Router
  // (assumes your project has Factory/Router contracts)
  // -------------------------
  const Factory = await ethers.getContractFactory("Factory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();

  const Router = await ethers.getContractFactory("Router");
  const router = await Router.deploy(addr(factory));
  await router.waitForDeployment();

  console.log("factory:", addr(factory));
  console.log("router :", addr(router));

  // -------------------------
  // Mint tokens to users for liquidity
  // -------------------------
  const mintAmt = ethers.parseUnits("1000000", 18);

  await tokenA.mint(alice.address, mintAmt);
  await tokenB.mint(alice.address, mintAmt);
  await tokenC.mint(alice.address, mintAmt);
  await tokenD.mint(alice.address, mintAmt);

  await tokenA.mint(bob.address, mintAmt);
  await tokenB.mint(bob.address, mintAmt);
  await tokenC.mint(bob.address, mintAmt);
  await tokenD.mint(bob.address, mintAmt);

  await tokenA.mint(deployer.address, mintAmt);
  await tokenB.mint(deployer.address, mintAmt);
  // -------------------------
  // Create 2 pairs by adding liquidity
  // pair0: A/B
  // pair1: C/D
  // -------------------------
  const liqA = ethers.parseUnits("10000", 18);
  const liqB = ethers.parseUnits("10000", 18);

  // Alice adds liquidity to A/B
  await tokenA.connect(alice).approve(addr(router), liqA);
  await tokenB.connect(alice).approve(addr(router), liqB);
  await router
    .connect(alice)
  ["addLiquidity(address,address,uint256,uint256,uint256,uint256,address)"](
    addr(tokenA),
    addr(tokenB),
    liqA,
    liqB,
    0,
    0,
    alice.address
  );

  // Bob adds liquidity to A/B too (so both have LP to stake)
  await tokenA.connect(bob).approve(addr(router), liqA);
  await tokenB.connect(bob).approve(addr(router), liqB);

  await router
    .connect(bob)
  ["addLiquidity(address,address,uint256,uint256,uint256,uint256,address)"](
    addr(tokenA),
    addr(tokenB),
    liqA,
    liqB,
    0,
    0,
    bob.address
  );

  // Alice adds liquidity to C/D
  await tokenC.connect(alice).approve(addr(router), liqA);
  await tokenD.connect(alice).approve(addr(router), liqB);
  await router
    .connect(alice)
  ["addLiquidity(address,address,uint256,uint256,uint256,uint256,address)"](
    addr(tokenC),
    addr(tokenD),
    liqA,
    liqB,
    0,
    0,
    alice.address
  );

  // Bob adds liquidity to C/D
  await tokenC.connect(bob).approve(addr(router), liqA);
  await tokenD.connect(bob).approve(addr(router), liqB);
  await router
    .connect(bob)
  ["addLiquidity(address,address,uint256,uint256,uint256,uint256,address)"](
    addr(tokenC),
    addr(tokenD),
    liqA,
    liqB,
    0,
    0,
    bob.address
  );

  const pair0Addr = await factory.getPair(addr(tokenA), addr(tokenB));
  const pair1Addr = await factory.getPair(addr(tokenC), addr(tokenD));
  console.log("pair0 (A/B):", pair0Addr);
  console.log("pair1 (C/D):", pair1Addr);

  // Optional: attach Pair to read balances
  const Pair = await ethers.getContractFactory("Pair");
  const pair0 = Pair.attach(pair0Addr);
  const pair1 = Pair.attach(pair1Addr);

  const aliceLP0 = await pair0.balanceOf(alice.address);
  const bobLP0 = await pair0.balanceOf(bob.address);
  const aliceLP1 = await pair1.balanceOf(alice.address);
  const bobLP1 = await pair1.balanceOf(bob.address);

  console.log("Alice LP0:", aliceLP0.toString());
  console.log("Bob   LP0:", bobLP0.toString());
  console.log("Alice LP1:", aliceLP1.toString());
  console.log("Bob   LP1:", bobLP1.toString());

  // -------------------------
  // Deploy MultiLPStaking (MasterChef-lite)
  // -------------------------
  const MultiLPStaking = await ethers.getContractFactory("MultiLPStaking");
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const startTime = now + 10; // start rewards 10s later
  const rewardPerSecond = ethers.parseUnits("1", 18); // 1 RWD/sec total

  const chef = await MultiLPStaking.deploy(addr(reward), rewardPerSecond, startTime);
  await chef.waitForDeployment();

  console.log("chef  :", addr(chef));
  console.log("start :", startTime);
  console.log("rps   :", rewardPerSecond.toString());

  // Fund chef with rewards (RewardToken mint is onlyOwner; deployer is owner)
  await reward.mint(addr(chef), ethers.parseUnits("500000", 18));

  // Add pools
  // alloc: pool0=100, pool1=300
  await chef.addPool(100, pair0Addr, false);
  await chef.addPool(300, pair1Addr, false);
  console.log("pools added.");

  // -------------------------
  // Approve + stake a bit for demo (optional but nice)
  // -------------------------
  const stakeAlice0 = aliceLP0 / 2n;
  const stakeBob0 = bobLP0 / 3n;
  const stakeAlice1 = aliceLP1 / 2n;
  const stakeBob1 = bobLP1 / 3n;

  await pair0.connect(alice).approve(addr(chef), stakeAlice0);
  await pair0.connect(bob).approve(addr(chef), stakeBob0);
  await pair1.connect(alice).approve(addr(chef), stakeAlice1);
  await pair1.connect(bob).approve(addr(chef), stakeBob1);

  await chef.connect(alice).deposit(0, stakeAlice0);
  await chef.connect(bob).deposit(0, stakeBob0);
  await chef.connect(alice).deposit(1, stakeAlice1);
  await chef.connect(bob).deposit(1, stakeBob1);

  console.log("Seed stakes done:");
  console.log("  Alice staked pool0:", stakeAlice0.toString());
  console.log("  Bob   staked pool0:", stakeBob0.toString());
  console.log("  Alice staked pool1:", stakeAlice1.toString());
  console.log("  Bob   staked pool1:", stakeBob1.toString());

  // -------------------------
  // Write addresses.json for frontend
  // -------------------------
  const chainId = (await ethers.provider.getNetwork()).chainId.toString();
  const out = {
    chainId,
    network: network.name,
    deployer: deployer.address,
    accounts: { alice: alice.address, bob: bob.address },
    tokens: {
      tokenA: addr(tokenA),
      tokenB: addr(tokenB),
      tokenC: addr(tokenC),
      tokenD: addr(tokenD),
      reward: addr(reward),
    },
    dex: {
      factory: addr(factory),
      router: addr(router),
      pair0: pair0Addr,
      pair1: pair1Addr,
    },
    chef: {
      address: addr(chef),
      startTime,
      rewardPerSecond: rewardPerSecond.toString(),
      pools: [
        { pid: 0, lpToken: pair0Addr, allocPoint: 100 },
        { pid: 1, lpToken: pair1Addr, allocPoint: 300 },
      ],
    },
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${network.name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("Wrote:", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
