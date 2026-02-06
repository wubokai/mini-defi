// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title LPStaking (MasterChef-lite)
 * @notice Stake LP token to earn rewards linearly over time.
 *
 * - Rewards accrue at `rewardPerSecond`
 * - Distribution is proportional to stake share
 * - Uses `accRewardPerShare` + `rewardDebt` accounting
 * - If rewardToken balance is insufficient, it pays what it can and records `unpaidRewards`
 */
contract LPStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable lpToken;
    IERC20 public immutable rewardToken;

    uint256 public rewardPerSecond;

    // global accounting
    uint256 public accRewardPerShare; // scaled by 1e12
    uint256 public lastRewardTime;
    uint256 public totalStaked;

    struct UserInfo {
        uint256 amount;        // staked LP
        uint256 rewardDebt;    // amount * accRewardPerShare / 1e12 at last user action
        uint256 unpaidRewards; // reward owed but not paid due to insufficient rewardToken balance
    }

    mapping(address => UserInfo) public userInfo;

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event Claim(address indexed user, uint256 amountPaid, uint256 unpaidRollover);
    event EmergencyWithdraw(address indexed user, uint256 amount);
    event RewardPerSecondUpdated(uint256 oldValue, uint256 newValue);

    constructor(
        address _lpToken,
        address _rewardToken,
        uint256 _rewardPerSecond
    ) Ownable(msg.sender) {
        require(_lpToken != address(0), "LPStaking: lpToken=0");
        require(_rewardToken != address(0), "LPStaking: rewardToken=0");

        lpToken = IERC20(_lpToken);
        rewardToken = IERC20(_rewardToken);
        rewardPerSecond = _rewardPerSecond;

        lastRewardTime = block.timestamp;
    }

    // -------------------------
    // view
    // -------------------------

    function pendingRewards(address user) external view returns (uint256) {
        UserInfo memory u = userInfo[user];

        uint256 _acc = accRewardPerShare;
        if (block.timestamp > lastRewardTime && totalStaked != 0) {
            uint256 elapsed = block.timestamp - lastRewardTime;
            uint256 reward = elapsed * rewardPerSecond;

            // cap by contract reward balance to avoid "imaginary" rewards
            uint256 bal = rewardToken.balanceOf(address(this));
            if (reward > bal) reward = bal;

            _acc = _acc + (reward * 1e12) / totalStaked;
        }

        uint256 pending = (u.amount * _acc) / 1e12;
        if (pending < u.rewardDebt) return u.unpaidRewards; // safety
        return (pending - u.rewardDebt) + u.unpaidRewards;
    }

    // -------------------------
    // core accounting
    // -------------------------

    function updatePool() public {
        if (block.timestamp <= lastRewardTime) return;

        if (totalStaked == 0) {
            lastRewardTime = block.timestamp;
            return;
        }

        uint256 elapsed = block.timestamp - lastRewardTime;
        uint256 reward = elapsed * rewardPerSecond;

        uint256 bal = rewardToken.balanceOf(address(this));
        if (reward > bal) reward = bal;

        if (reward > 0) {
            accRewardPerShare = accRewardPerShare + (reward * 1e12) / totalStaked;
        }
        lastRewardTime = block.timestamp;
    }

    function _harvest(address user) internal returns (uint256 paid, uint256 unpaidRollover) {
        UserInfo storage u = userInfo[user];

        uint256 accumulated = (u.amount * accRewardPerShare) / 1e12;
        uint256 pending = 0;
        if (accumulated >= u.rewardDebt) {
            pending = accumulated - u.rewardDebt;
        }

        pending += u.unpaidRewards;

        if (pending == 0) {
            u.unpaidRewards = 0;
            return (0, 0);
        }

        uint256 bal = rewardToken.balanceOf(address(this));
        if (pending > bal) {
            paid = bal;
            unpaidRollover = pending - bal;
        } else {
            paid = pending;
            unpaidRollover = 0;
        }

        if (paid > 0) {
            rewardToken.safeTransfer(user, paid);
        }

        u.unpaidRewards = unpaidRollover;

        emit Claim(user, paid, unpaidRollover);
    }

    // -------------------------
    // user actions
    // -------------------------

    function deposit(uint256 amount) external nonReentrant {
        UserInfo storage u = userInfo[msg.sender];

        updatePool();
        _harvest(msg.sender);

        if (amount > 0) {
            lpToken.safeTransferFrom(msg.sender, address(this), amount);
            u.amount += amount;
            totalStaked += amount;
        }

        u.rewardDebt = (u.amount * accRewardPerShare) / 1e12;

        emit Deposit(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        UserInfo storage u = userInfo[msg.sender];
        require(u.amount >= amount, "LPStaking: insufficient stake");

        updatePool();
        _harvest(msg.sender);

        if (amount > 0) {
            u.amount -= amount;
            totalStaked -= amount;
            lpToken.safeTransfer(msg.sender, amount);
        }

        u.rewardDebt = (u.amount * accRewardPerShare) / 1e12;

        emit Withdraw(msg.sender, amount);
    }

    function claim() external nonReentrant {
        UserInfo storage u = userInfo[msg.sender];

        updatePool();
        _harvest(msg.sender);

        u.rewardDebt = (u.amount * accRewardPerShare) / 1e12;
    }

    function emergencyWithdraw() external nonReentrant {
        UserInfo storage u = userInfo[msg.sender];
        uint256 amt = u.amount;

        u.amount = 0;
        u.rewardDebt = 0;
        u.unpaidRewards = 0;

        if (amt > 0) {
            totalStaked -= amt;
            lpToken.safeTransfer(msg.sender, amt);
        }

        emit EmergencyWithdraw(msg.sender, amt);
    }

    // -------------------------
    // admin
    // -------------------------

    function setRewardPerSecond(uint256 newValue) external onlyOwner {
        updatePool();
        emit RewardPerSecondUpdated(rewardPerSecond, newValue);
        rewardPerSecond = newValue;
    }

    /**
     * @notice optional helper: owner can pull accidentally sent tokens (NOT lpToken or rewardToken)
     */
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        require(token != address(lpToken), "LPStaking: cannot rescue LP");
        require(token != address(rewardToken), "LPStaking: cannot rescue reward");
        IERC20(token).safeTransfer(to, amount);
    }
}
