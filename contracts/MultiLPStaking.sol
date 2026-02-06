// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MultiLPStaking (MasterChef-lite, multi-pool)
 * @notice Single reward token, multiple LP pools, reward distributed by allocPoint.
 *
 * Accounting:
 *  - pool.accRewardPerShare scaled by 1e12
 *  - user.rewardDebt = user.amount * pool.accRewardPerShare / 1e12
 *
 * startTime:
 *  - rewards only accrue after startTime
 *
 * Funding:
 *  - Contract must be funded with rewardToken.
 *  - If balance is insufficient at harvest time, pays what it can (does NOT revert).
 */
contract MultiLPStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct PoolInfo {
        IERC20 lpToken;              // LP token
        uint256 allocPoint;          // allocation points
        uint256 lastRewardTime;      // last timestamp rewards were calculated
        uint256 accRewardPerShare;   // accumulated rewards per share, scaled by 1e12
        uint256 totalStaked;         // total LP staked in this pool
    }

    struct UserInfo {
        uint256 amount;      // staked LP amount
        uint256 rewardDebt;  // accounting
    }

    IERC20 public immutable rewardToken;
    uint256 public rewardPerSecond;
    uint256 public totalAllocPoint;
    uint256 public startTime;

    PoolInfo[] public poolInfo;
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;

    event AddPool(uint256 indexed pid, address lpToken, uint256 allocPoint);
    event SetPool(uint256 indexed pid, uint256 oldAllocPoint, uint256 newAllocPoint);
    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event Harvest(address indexed user, uint256 indexed pid, uint256 amountPaid);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event RewardPerSecondUpdated(uint256 oldValue, uint256 newValue);
    event StartTimeUpdated(uint256 oldValue, uint256 newValue);

    constructor(
        address _rewardToken,
        uint256 _rewardPerSecond,
        uint256 _startTime
    ) Ownable(msg.sender) {
        require(_rewardToken != address(0), "rewardToken=0");
        rewardToken = IERC20(_rewardToken);
        rewardPerSecond = _rewardPerSecond;
        startTime = _startTime;
    }

    // ---------------- view ----------------

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    function pendingRewards(uint256 pid, address user) external view returns (uint256) {
        PoolInfo memory p = poolInfo[pid];
        UserInfo memory u = userInfo[pid][user];

        uint256 acc = p.accRewardPerShare;
        uint256 last = p.lastRewardTime;

        uint256 t = block.timestamp;
        if (t < startTime) t = startTime;

        if (t > last && p.totalStaked != 0 && totalAllocPoint != 0) {
            uint256 elapsed = t - last;
            uint256 poolReward = (elapsed * rewardPerSecond * p.allocPoint) / totalAllocPoint;
            acc = acc + (poolReward * 1e12) / p.totalStaked;
        }

        uint256 accumulated = (u.amount * acc) / 1e12;
        if (accumulated < u.rewardDebt) return 0;
        return accumulated - u.rewardDebt;
    }

    // ---------------- admin ----------------

    function addPool(uint256 allocPoint, address lpToken, bool withUpdate) external onlyOwner {
        require(lpToken != address(0), "lpToken=0");
        if (withUpdate) massUpdatePools();

        uint256 t = block.timestamp;
        if (t < startTime) t = startTime;

        poolInfo.push(
            PoolInfo({
                lpToken: IERC20(lpToken),
                allocPoint: allocPoint,
                lastRewardTime: t,
                accRewardPerShare: 0,
                totalStaked: 0
            })
        );

        totalAllocPoint += allocPoint;
        emit AddPool(poolInfo.length - 1, lpToken, allocPoint);
    }

    function setPool(uint256 pid, uint256 newAllocPoint, bool withUpdate) external onlyOwner {
        if (withUpdate) massUpdatePools();

        uint256 old = poolInfo[pid].allocPoint;
        poolInfo[pid].allocPoint = newAllocPoint;

        totalAllocPoint = totalAllocPoint - old + newAllocPoint;
        emit SetPool(pid, old, newAllocPoint);
    }

    function setRewardPerSecond(uint256 newValue, bool withUpdate) external onlyOwner {
        if (withUpdate) massUpdatePools();
        emit RewardPerSecondUpdated(rewardPerSecond, newValue);
        rewardPerSecond = newValue;
    }

    function setStartTime(uint256 newStartTime, bool withUpdate) external onlyOwner {
        require(block.timestamp < startTime, "already started");
        require(newStartTime >= block.timestamp, "start in past");
        if (withUpdate) massUpdatePools();

        emit StartTimeUpdated(startTime, newStartTime);
        startTime = newStartTime;

        uint256 len = poolInfo.length;
        for (uint256 i = 0; i < len; i++) {
            poolInfo[i].lastRewardTime = newStartTime;
        }
    }

    // ---------------- core accounting ----------------

    function massUpdatePools() public {
        uint256 len = poolInfo.length;
        for (uint256 i = 0; i < len; i++) updatePool(i);
    }

    function updatePool(uint256 pid) public {
        PoolInfo storage p = poolInfo[pid];

        uint256 t = block.timestamp;
        if (t < startTime) t = startTime;

        if (t <= p.lastRewardTime) return;

        if (p.totalStaked == 0 || p.allocPoint == 0 || totalAllocPoint == 0) {
            p.lastRewardTime = t;
            return;
        }

        uint256 elapsed = t - p.lastRewardTime;
        uint256 poolReward = (elapsed * rewardPerSecond * p.allocPoint) / totalAllocPoint;

        p.accRewardPerShare = p.accRewardPerShare + (poolReward * 1e12) / p.totalStaked;
        p.lastRewardTime = t;
    }

    function _harvest(uint256 pid, address to) internal returns (uint256 paid) {
        PoolInfo storage p = poolInfo[pid];
        UserInfo storage u = userInfo[pid][to];

        uint256 accumulated = (u.amount * p.accRewardPerShare) / 1e12;
        if (accumulated <= u.rewardDebt) return 0;

        uint256 pending = accumulated - u.rewardDebt;

        uint256 bal = rewardToken.balanceOf(address(this));
        paid = pending > bal ? bal : pending;

        if (paid > 0) rewardToken.safeTransfer(to, paid);

        emit Harvest(to, pid, paid);
    }

    // ---------------- user actions ----------------

    function deposit(uint256 pid, uint256 amount) external nonReentrant {
        PoolInfo storage p = poolInfo[pid];
        UserInfo storage u = userInfo[pid][msg.sender];

        updatePool(pid);
        _harvest(pid, msg.sender);

        if (amount > 0) {
            p.lpToken.safeTransferFrom(msg.sender, address(this), amount);
            u.amount += amount;
            p.totalStaked += amount;
        }

        u.rewardDebt = (u.amount * p.accRewardPerShare) / 1e12;
        emit Deposit(msg.sender, pid, amount);
    }

    function withdraw(uint256 pid, uint256 amount) external nonReentrant {
        PoolInfo storage p = poolInfo[pid];
        UserInfo storage u = userInfo[pid][msg.sender];
        require(u.amount >= amount, "insufficient stake");

        updatePool(pid);
        _harvest(pid, msg.sender);

        if (amount > 0) {
            u.amount -= amount;
            p.totalStaked -= amount;
            p.lpToken.safeTransfer(msg.sender, amount);
        }

        u.rewardDebt = (u.amount * p.accRewardPerShare) / 1e12;
        emit Withdraw(msg.sender, pid, amount);
    }

    function harvest(uint256 pid) external nonReentrant {
        PoolInfo storage p = poolInfo[pid];
        UserInfo storage u = userInfo[pid][msg.sender];

        updatePool(pid);
        _harvest(pid, msg.sender);

        u.rewardDebt = (u.amount * p.accRewardPerShare) / 1e12;
    }

    function withdrawAndHarvest(uint256 pid, uint256 amount) external nonReentrant {
        PoolInfo storage p = poolInfo[pid];
        UserInfo storage u = userInfo[pid][msg.sender];
        require(u.amount >= amount, "insufficient stake");

        updatePool(pid);
        _harvest(pid, msg.sender);

        if (amount > 0) {
            u.amount -= amount;
            p.totalStaked -= amount;
            p.lpToken.safeTransfer(msg.sender, amount);
        }

        u.rewardDebt = (u.amount * p.accRewardPerShare) / 1e12;
        emit Withdraw(msg.sender, pid, amount);
    }

    function emergencyWithdraw(uint256 pid) external nonReentrant {
        PoolInfo storage p = poolInfo[pid];
        UserInfo storage u = userInfo[pid][msg.sender];

        uint256 amt = u.amount;
        u.amount = 0;
        u.rewardDebt = 0;

        if (amt > 0) {
            p.totalStaked -= amt;
            p.lpToken.safeTransfer(msg.sender, amt);
        }

        emit EmergencyWithdraw(msg.sender, pid, amt);
    }
}
