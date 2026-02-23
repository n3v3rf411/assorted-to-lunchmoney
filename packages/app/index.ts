import { confirm } from '@inquirer/prompts'
import { type InsertTransaction, LunchMoneyError, type User } from '@lunch-money/lunch-money-js-v2'
import { details, error, info } from '@repo/logger'

import { syncMoneyForwardAccounts, syncRevolutAccounts } from './accounts.ts'
import { loadTransactions as loadMoneyForwardTransactions } from './money-forward/importer.ts'
import { loadTransactions as loadRevolutTransactions, RevolutTransactionState } from './revolut/importer.ts'
import { scrape } from './scraper.ts'
import { lm, setup } from './setup.ts'

setup()

// Get current user
const userData: User = await lm.user.getMe()
info(`Current user: %s | %s`, details(userData.name), details(userData.email))

await processMoneyForward()
await processRevolut()

async function insertTransactionsBatch(
    transactions: InsertTransaction[],
    batchSize: number = 500
): Promise<{ inserted: number; skipped: number }> {
    let totalInserted = 0
    let totalSkipped = 0

    for (let i = 0; i < transactions.length; i += batchSize) {
        const batch = transactions.slice(i, i + batchSize)

        if (batch.length === 0) {
            continue
        }

        const result = await lm.transactions.create({
            transactions: batch,
            skip_duplicates: false,
            apply_rules: true,
        })

        totalInserted += result.transactions.length
        totalSkipped += result.skipped_duplicates.length

        info(
            `Batch %s: Inserted %s, Skipped %s duplicates`,
            details(Math.floor(i / batchSize) + 1),
            details(result.transactions.length),
            details(result.skipped_duplicates.length)
        )
    }

    return { inserted: totalInserted, skipped: totalSkipped }
}

async function processMoneyForward() {
    const scrapeMoneyForward = await confirm({
        message: 'Scrape updates from Money Forward?',
        default: false,
    })
    if (scrapeMoneyForward) {
        info(`Scraping from Money Forward...`)
        await scrape()
    }

    info(`Syncing Money Forward accounts`)
    const mfNameToLmId: Map<string, number> = new Map(
        (await syncMoneyForwardAccounts()).map((it) => [it.account_name, it.lm_id])
    )

    info(`Loading transactions from CSV files...`)
    const mfTransactions = await loadMoneyForwardTransactions(18)
    info(`Loaded %s transactions`, details(mfTransactions.length))

    try {
        info(`Inserting transactions into Lunch Money...`)

        const lmTransactions = mfTransactions
            .map((t) => ({
                manual_account_id: mfNameToLmId.get(t.institution),
                date: t.date.replace(/\//g, '-'),
                amount: -t.amount,
                payee: t.description.slice(0, 140),
                notes: t.description,
                external_id: t.id,
            }))
            .filter((manual_account_id) => manual_account_id !== undefined)

        const { inserted, skipped } = await insertTransactionsBatch(lmTransactions)

        info(`Complete! Inserted %s transactions, skipped %s duplicates`, details(inserted), details(skipped))
        info(`Done!`)
    } catch (e) {
        if (e instanceof LunchMoneyError) {
            error(`Error inserting transactions: ${details(e.message)}`, e.errors)
            process.exit(1)
        } else {
            throw e
        }
    }
}

async function processRevolut() {
    info(`Loading transactions from CSV files...`)
    const unfilteredRevolutTransactions = await loadRevolutTransactions()
    const revolutTransactions = unfilteredRevolutTransactions.filter(
        (it) => it.state === RevolutTransactionState.COMPLETED
    )
    info(`Loaded %s completed transactions`, details(revolutTransactions.length))

    info(`Syncing Revolut accounts`)
    const accounts = [...new Set(unfilteredRevolutTransactions.map((it) => it.currency))]
    const revolutNameToLmId: Map<string, number> = new Map(
        (await syncRevolutAccounts(accounts)).map((it) => [it.account_name, it.lm_id])
    )

    try {
        info(`Inserting transactions into Lunch Money...`)

        const lmTransactions = revolutTransactions
            .map((t) => ({
                manual_account_id: revolutNameToLmId.get(t.currency),
                date: t.startedDate.substring(0, 10),
                amount: -t.amount - t.fee,
                payee: t.description.slice(0, 140),
                notes: t.description,
                external_id: t.externalId,
            }))
            .filter((manual_account_id) => manual_account_id !== undefined)

        const { inserted, skipped } = await insertTransactionsBatch(lmTransactions)

        info(`Complete! Inserted %s transactions, skipped %s duplicates`, details(inserted), details(skipped))
        info(`Done!`)
    } catch (e) {
        if (e instanceof LunchMoneyError) {
            error(`Error inserting transactions: ${details(e.message)}`, e.errors)
            process.exit(1)
        } else {
            throw e
        }
    }
}
