import { PublicKey, Keypair, Connection, Transaction } from '@solana/web3.js'
import {
  PDAUtil, buildWhirlpoolClient, PriceMath, swapQuoteByInputToken, WhirlpoolContext
} from '@renec/redex-sdk'
import { DecimalUtil, Percentage } from '@orca-so/common-sdk'
import { loadProvider, delay, getTokenMintInfo, A_HUNDRED_PERCENT } from './utils'
import Decimal from 'decimal.js'
import config from './config.json'
import deployed from './deployed.json'

async function main() {
  const { ctx } = await loadProvider()
  /** In case use `@solana/wallet-adapter-react` lib on UI */

  // const wallet = useAnchorWallet()
  // const connection = new Connection('https://api.mainnet-beta.solana.com')
  // if (wallet) {
  //   const provider = new AnchorProvider(connection, wallet, {})
  //   const ctx = WhirlpoolContext.withProvider(provider, new PublicKey(config.REDEX_PROGRAM_ID))
  // }

  if (deployed.REDEX_CONFIG_PUB === '') {
    console.log('ReDEX Pool Config is not found. Please run `npm run 00-create-pool-config` .')
    return 
  }
  const REDEX_CONFIG_PUB = new PublicKey(deployed.REDEX_CONFIG_PUB)
  const client = buildWhirlpoolClient(ctx)
  /**
   * A pool's public key is defined by:
   *  + token a mint pub
   *  + token b mint pub
   *  + tick spacing default = 8 or 64
   */
  for (let i = 0; i < config.POOLS.length; i++) {
    const pool = config.POOLS[i]
    const mintAPub = new PublicKey(pool.TOKEN_MINT_A)
    const mintBPub = new PublicKey(pool.TOKEN_MINT_B)
    const whirlpoolPda = PDAUtil.getWhirlpool(
      ctx.program.programId,
      REDEX_CONFIG_PUB,
      mintAPub,
      mintBPub,
      pool.TICK_SPACING
    )
    console.log(whirlpoolPda.publicKey.toBase58())
    const whirlpool = await client.getPool(whirlpoolPda.publicKey)

    if (whirlpool) {
      const whirlpoolData = whirlpool.getData()
      const tokenMintA = whirlpool.getTokenAInfo()
      const tokenMintB = whirlpool.getTokenBInfo()
      
      const price = PriceMath.sqrtPriceX64ToPrice(whirlpoolData.sqrtPrice, tokenMintA.decimals, tokenMintB.decimals)
      const invertPrice = PriceMath.invertPrice(price, tokenMintA.decimals, tokenMintB.decimals)
      console.log('===================================================')
      console.log('POOL INFO:')
      console.log('RENEC:', tokenMintA.mint.toBase58())
      console.log('rUSDT:', tokenMintB.mint.toBase58())
      console.log('Tick spacing:', whirlpoolData.tickSpacing)
      console.log('1 RENEC =', price.toFixed(tokenMintB.decimals), 'rUSDT')
      console.log('1 rUSDT =', invertPrice.toFixed(tokenMintB.decimals), 'RENEC')
      console.log('Trade Fee rate:', whirlpoolData.feeRate / A_HUNDRED_PERCENT, '%')
      console.log('==================RENEC_TO_rUSDT====================')
      const inputSlippage = '1.1' // 1.1 %
      const slippageTolerance = Percentage.fromDecimal(new Decimal(inputSlippage))
      console.log('Slippage Tolerance:', inputSlippage, '%')

      let inputToken = tokenMintA // convert from `tokenMintA` to `tokenMintB` => inputToken = `tokenMintA`
      let inputAmount = '1.5' // 20.5 tokens
      let amountIn = new Decimal(inputAmount)

      let quote = await swapQuoteByInputToken(
        whirlpool,
        inputToken.mint,
        DecimalUtil.toU64(amountIn, inputToken.decimals),
        slippageTolerance,
        ctx.program.programId,
        ctx.fetcher,
        true
      )
      console.log('Input:', DecimalUtil.fromU64(quote.estimatedAmountIn, inputToken.decimals).toString(), 'RENEC')
      console.log('Estimated received:', DecimalUtil.fromU64(quote.estimatedAmountOut, tokenMintB.decimals).toString(), 'rUSDT')
      console.log('Minimum received:', DecimalUtil.fromU64(quote.otherAmountThreshold, tokenMintB.decimals).toString(), 'rUSDT')

      let tx = await whirlpool.swap(quote, new PublicKey(config.REDEX_PROGRAM_ID))
      let ixs = tx.compressIx(true)
      let unsignedTx = (await tx.build()).transaction
      // console.log(unsignedTx)
      // on Solflare
      // let signedTx = await wallet.signTransaction(unsignedTx);
      // let txid = await connection.sendRawTransaction(signedTx.serialize());
  
      console.log('==================rUSDT_TO_RENEC====================')
      console.log('Slippage Tolerance:', inputSlippage, '%')
      inputToken = tokenMintB
      inputAmount = '20'
      amountIn = new Decimal(inputAmount)

      quote = await swapQuoteByInputToken(
        whirlpool,
        inputToken.mint,
        DecimalUtil.toU64(amountIn, inputToken.decimals),
        slippageTolerance,
        ctx.program.programId,
        ctx.fetcher,
        true
      )
      console.log('Input:', DecimalUtil.fromU64(quote.estimatedAmountIn, inputToken.decimals).toString(), 'rUSDT')
      console.log('Estimated received:', DecimalUtil.fromU64(quote.estimatedAmountOut, tokenMintA.decimals).toString(), 'RENEC')
      console.log('Minimum received:', DecimalUtil.fromU64(quote.otherAmountThreshold, tokenMintA.decimals).toString(), 'RENEC')
      tx = await whirlpool.swap(quote)
      unsignedTx = (await tx.build()).transaction
      // on Solflare
      // let signedTx = await wallet.signTransaction(unsignedTx);
      // let txid = await connection.sendRawTransaction(signedTx.serialize());
    }
  }
}

main().catch((reason) => {
  console.log('ERROR:', reason)
}) 