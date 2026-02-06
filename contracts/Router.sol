// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFactory {
    function getPair(
        address tokenA,
        address tokenB
    ) external view returns (address pair);
    function createPair(
        address tokenA,
        address tokenB
    ) external returns (address pair);
}

interface IPair {
    function token0() external view returns (address);
    function token1() external view returns (address);

    function burn(
        address to
    ) external returns (uint256 amount0, uint256 amount1);

    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1);

    function mint(address to) external returns (uint256 liquidity);

    function swap(uint256 amount0Out, uint256 amount1Out, address to) external;
}

contract Router {
    address public immutable factory;

    error PairNotFound();
    error InvalidPath();
    error InsufficientAAmount();
    error InsufficientBAmount();
    error InsufficientOutputAmount();
    error TransferFailed();
    error Expired();
    error InvalidTo();

    constructor(address _factory) {
        factory = _factory;
    }

    // -------- math helpers --------
    function quote(
        uint256 amountA,
        uint256 reserveA,
        uint256 reserveB
    ) public pure returns (uint256 amountB) {
        require(amountA > 0, "INSUFFICIENT_AMOUNT");
        require(reserveA > 0 && reserveB > 0, "INSUFFICIENT_LIQUIDITY");
        amountB = (amountA * reserveB) / reserveA;
    }

    // Uniswap v2: 0.3% fee -> 997/1000
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256) {
        require(amountIn > 0, "INSUFFICIENT_INPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "INSUFFICIENT_LIQUIDITY");
        uint256 amountInWithFee = amountIn * 997;
        return
            (amountInWithFee * reserveOut) /
            (reserveIn * 1000 + amountInWithFee);
    }

    function _safeTransferFrom(
        address token,
        address from,
        address to,
        uint256 value
    ) private {
        bool ok = IERC20(token).transferFrom(from, to, value);
        if (!ok) revert TransferFailed();
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        bool ok = IERC20(token).transfer(to, value);
        if (!ok) revert TransferFailed();
    }

    function _getOrCreatePair(
        address tokenA,
        address tokenB
    ) private returns (address pair) {
        pair = IFactory(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) {
            pair = IFactory(factory).createPair(tokenA, tokenB);
        }
    }

    function _getReservesFor(
        address pair,
        address tokenA,
        address tokenB
    ) private view returns (uint256 reserveA, uint256 reserveB) {
        address t0 = IPair(pair).token0();
        (uint112 r0, uint112 r1) = IPair(pair).getReserves();
        if (tokenA == t0) {
            reserveA = uint256(r0);
            reserveB = uint256(r1);
        } else {
            reserveA = uint256(r1);
            reserveB = uint256(r0);
        }
    }

    function _ensure(uint256 deadline) private view {
        if (block.timestamp > deadline) revert Expired();
    }

    // -------- user functions --------

    /// @notice add liquidity with optimal ratio if pool already has liquidity

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256 amountOut) {
        _ensure(deadline);
        if (to == address(0)) revert InvalidTo();
        if (path.length < 2) revert InvalidPath();

        uint256[] memory amounts = getAmountsOut(amountIn, path);
        amountOut = amounts[amounts.length - 1];

        if (amountOut < amountOutMin) revert InsufficientOutputAmount();

        // transfer input token to first pair
        address firstPair = IFactory(factory).getPair(path[0], path[1]);
        if (firstPair == address(0)) revert PairNotFound();
        _safeTransferFrom(path[0], msg.sender, firstPair, amountIn);

        // execute hops
        _swap(amounts, path, to);
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        address pair = _getOrCreatePair(tokenA, tokenB);

        (uint256 reserveA, uint256 reserveB) = _getReservesFor(
            pair,
            tokenA,
            tokenB
        );

        if (reserveA == 0 && reserveB == 0) {
            // first liquidity: accept desired amounts
            amountA = amountADesired;
            amountB = amountBDesired;
        } else {
            uint256 amountBOptimal = quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                if (amountBOptimal < amountBMin) revert InsufficientBAmount();
                amountA = amountADesired;
                amountB = amountBOptimal;
            } else {
                uint256 amountAOptimal = quote(
                    amountBDesired,
                    reserveB,
                    reserveA
                );
                if (amountAOptimal < amountAMin) revert InsufficientAAmount();
                amountA = amountAOptimal;
                amountB = amountBDesired;
            }
        }

        // pull tokens from user into Pair
        _safeTransferFrom(tokenA, msg.sender, pair, amountA);
        _safeTransferFrom(tokenB, msg.sender, pair, amountB);

        liquidity = IPair(pair).mint(to);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to
    ) external returns (uint256 amountA, uint256 amountB) {
        address pair = IFactory(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) revert PairNotFound();

        // 1) user transfers LP token to Pair
        bool ok = IERC20(pair).transferFrom(msg.sender, pair, liquidity);
        if (!ok) revert TransferFailed();

        // 2) burn from Pair -> tokens sent to `to`
        (uint256 amount0, uint256 amount1) = IPair(pair).burn(to);

        // 3) map (amount0, amount1) to (amountA, amountB)
        address t0 = IPair(pair).token0();
        (amountA, amountB) = tokenA == t0
            ? (amount0, amount1)
            : (amount1, amount0);

        if (amountA < amountAMin) revert InsufficientAAmount();
        if (amountB < amountBMin) revert InsufficientBAmount();
    }

    
    // helper: read pair address
    function getPair(
        address tokenA,
        address tokenB
    ) external view returns (address) {
        return IFactory(factory).getPair(tokenA, tokenB);
    }

    function getAmountsOut(
        uint256 amountIn,
        address[] memory path
    ) public view returns (uint256[] memory amounts) {
        if (path.length < 2) revert InvalidPath();
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;

        for (uint256 i = 0; i < path.length - 1; i++) {
            address tokenIn = path[i];
            address tokenOut = path[i + 1];

            address pair = IFactory(factory).getPair(tokenIn, tokenOut);
            if (pair == address(0)) revert PairNotFound();

            (uint256 reserveIn, uint256 reserveOut) = _getReservesFor(
                pair,
                tokenIn,
                tokenOut
            );
            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    function _swap(
        uint256[] memory amounts,
        address[] memory path,
        address _to
    ) private {
        for (uint256 i = 0; i < path.length - 1; i++) {
            address tokenIn = path[i];
            address tokenOut = path[i + 1];

            address pair = IFactory(factory).getPair(tokenIn, tokenOut);
            if (pair == address(0)) revert PairNotFound();

            // next recipient: next pair, or final to
            address to = (i < path.length - 2)
                ? IFactory(factory).getPair(tokenOut, path[i + 2])
                : _to;

            uint256 amountOut = amounts[i + 1];

            address t0 = IPair(pair).token0();
            uint256 amount0Out = tokenOut == t0 ? amountOut : 0;
            uint256 amount1Out = tokenOut == t0 ? 0 : amountOut;

            IPair(pair).swap(amount0Out, amount1Out, to);
        }
    }
}
