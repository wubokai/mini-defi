# mini-defi (MiniSwap + MultiLPStaking)

A tutorial/practice-oriented DeFi mini-project featuring:
- Uniswap V2-style **AMM DEX** (Factory / Pair / Router)
- MasterChef-lite style **multi-pool LP staking mining** (MultiLPStaking)

Ideal for understanding:
- Constant product liquidity provision (x * y = k)
- LP share minting/burning
- Router single-hop / multi-hop swaps
- Mining rewards with allocPoint weight distribution

---

## Features

### DEX
- ✅ Create trading pairs: `Factory.createPair(tokenA, tokenB)`
- ✅ Auto-retrieve pairs: `Factory.getPair(tokenA, tokenB)`
- ✅ Add/remove liquidity: `Router.addLiquidity` / `Router.removeLiquidity`
- ✅ Token swaps: `Router.swapExactTokensForTokens`
- ✅ Supports multihop swaps
- ✅ Transaction fee: **0.3%** (calculated as 997/1000 in Uniswap V2)

### Farming (MultiLP Staking)
- ✅ Single reward token, multiple LP pools (multi-pool)
- ✅ Reward output per second: `rewardPerSecond`
- ✅ Allocate rewards across pools using `allocPoint`
- ✅ Interest accrual begins after `startTime`
- ✅ When contract reward balance is insufficient: Distribute based on available balance (no reversion)

---

## Contract Overview

- `Factory.sol`  
  Creates/manages Pairs, maintains `getPair(tokenA, tokenB)` mapping and `allPairs`

- `Pair.sol`  
  Trading pair contract + LP Token (ERC20: `MiniSwap LP / MSLP`)  
  Provides `mint / burn / swap / getReserves`

- `Router.sol`  
  User-facing interaction entry: Add/remove liquidity, swap, multi-hop routing, etc.

- `MultiLPStaking.sol`  
  MasterChef-lite: Staking across multiple LP pools, distributing a single reward token weighted by stakes

- `MockERC20.sol`  
  Test token, freely mintable with customizable decimals

- `RewardToken.sol`  
  Reward token, mintable only by owner (used to fund MultiLPStaking rewards)

---

## Tech Stack

- Solidity `^0.8.24`
- Hardhat + hardhat-toolbox
- OpenZeppelin Contracts (ERC20 / Ownable / ReentrancyGuard / SafeERC20)
- Mocha/Chai testing (`test/*.test.js`)

---

## Quick Start (Windows)

1. Install dependencies
```bash
npm install

2. Compile contracts
npx hardhat compile

3. Run tests
npx hardhat test

4. Deploy locally
npx hardhat run scripts/deploy.js --network hardhat

This program:
Deploys Mock tokens (TokenA/B/C/D) and RewardToken
Deploys Factory + Router
Adds liquidity pools for A/B and C/D to generate LP tokens
Deploys MultiLPStaking and injects reward tokens
Adds multiple staking pools (with different allocPoints)
Enables Alice/Bob to stake LP tokens,

Translated with DeepL.com (free version)
