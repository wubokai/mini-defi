// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Pair is ERC20 {
    address public token0;
    address public token1;

    uint112 private reserve0; // uses single storage slot, accessible via getReserves
    uint112 private reserve1;

    event Sync(uint112 reserve0, uint112 reserve1);
    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );

    constructor(address _token0, address _token1) ERC20("MiniSwap LP", "MSLP") {
        require(_token0 != _token1, "IDENTICAL_ADDRESSES");
        require(_token0 != address(0) && _token1 != address(0), "ZERO_ADDRESS");
        token0 = _token0;
        token1 = _token1;
    }

    function getReserves() external view returns (uint112 _reserve0, uint112 _reserve1) {
        return (reserve0, reserve1);
    }

    function _update(uint256 balance0, uint256 balance1) private {
        require(balance0 <= type(uint112).max && balance1 <= type(uint112).max, "OVERFLOW");
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        emit Sync(reserve0, reserve1);
    }

    function _min(uint256 x, uint256 y) private pure returns (uint256) {
        return x < y ? x : y;
    }

    // integer sqrt, Babylonian method
    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = (y / 2) + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    // ---------------------------------------
    // Liquidity: mint / burn
    // ---------------------------------------

    /// @notice Add liquidity.
    /// @dev User must transfer token0 & token1 to this Pair FIRST, then call mint(to).
    function mint(address to) external returns (uint256 liquidity) {
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));

        uint256 amount0 = balance0 - reserve0;
        uint256 amount1 = balance1 - reserve1;

        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            liquidity = _sqrt(amount0 * amount1);
            require(liquidity > 0, "INSUFFICIENT_LIQUIDITY_MINTED");
        } else {
            // proportional: min(amount0/reserve0, amount1/reserve1) * totalSupply
            liquidity = _min((amount0 * _totalSupply) / reserve0, (amount1 * _totalSupply) / reserve1);
            require(liquidity > 0, "INSUFFICIENT_LIQUIDITY_MINTED");
        }

        _mint(to, liquidity);
        _update(balance0, balance1);

        emit Mint(msg.sender, amount0, amount1);
    }

    /// @notice Remove liquidity.
    /// @dev User must transfer LP tokens to this Pair FIRST, then call burn(to).
    function burn(address to) external returns (uint256 amount0, uint256 amount1) {
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));

        uint256 liquidity = balanceOf(address(this));
        uint256 _totalSupply = totalSupply();

        amount0 = (liquidity * balance0) / _totalSupply;
        amount1 = (liquidity * balance1) / _totalSupply;

        require(amount0 > 0 && amount1 > 0, "INSUFFICIENT_LIQUIDITY_BURNED");

        _burn(address(this), liquidity);

        // transfer out tokens
        require(IERC20(token0).transfer(to, amount0), "T0_TRANSFER_FAILED");
        require(IERC20(token1).transfer(to, amount1), "T1_TRANSFER_FAILED");

        // update reserves after transfers
        balance0 = IERC20(token0).balanceOf(address(this));
        balance1 = IERC20(token1).balanceOf(address(this));
        _update(balance0, balance1);

        emit Burn(msg.sender, amount0, amount1, to);
    }

    // ---------------------------------------
    // Swap
    // ---------------------------------------

    /// @notice Swap with 0.3% fee, UniswapV2-style invariant check.
    /// @dev Trader can either set amount0Out or amount1Out (or both, but usually one side).
    ///      Trader must send input token(s) to this Pair BEFORE calling swap.
    function swap(uint256 amount0Out, uint256 amount1Out, address to) external {
        require(amount0Out > 0 || amount1Out > 0, "INSUFFICIENT_OUTPUT");
        require(to != token0 && to != token1, "INVALID_TO");

        uint112 _reserve0 = reserve0;
        uint112 _reserve1 = reserve1;

        require(amount0Out < _reserve0 && amount1Out < _reserve1, "INSUFFICIENT_LIQUIDITY");

        // optimistic transfer out
        if (amount0Out > 0) require(IERC20(token0).transfer(to, amount0Out), "T0_TRANSFER_FAILED");
        if (amount1Out > 0) require(IERC20(token1).transfer(to, amount1Out), "T1_TRANSFER_FAILED");

        // compute balances after transfers, infer input
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));

        uint256 amount0In = balance0 > uint256(_reserve0) - amount0Out
            ? balance0 - (uint256(_reserve0) - amount0Out)
            : 0;

        uint256 amount1In = balance1 > uint256(_reserve1) - amount1Out
            ? balance1 - (uint256(_reserve1) - amount1Out)
            : 0;

        require(amount0In > 0 || amount1In > 0, "INSUFFICIENT_INPUT");

        // fee = 0.3%, keep fee in pool
        // invariant: (balance0*1000 - amount0In*3) * (balance1*1000 - amount1In*3) >= reserve0*reserve1*1000^2
        uint256 balance0Adjusted = balance0 * 1000 - amount0In * 3;
        uint256 balance1Adjusted = balance1 * 1000 - amount1In * 3;

        require(
            balance0Adjusted * balance1Adjusted >= uint256(_reserve0) * uint256(_reserve1) * (1000**2),
            "K"
        );

        _update(balance0, balance1);

        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }
}
