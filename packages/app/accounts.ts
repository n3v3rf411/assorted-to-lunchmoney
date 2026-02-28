import { confirm, input, Separator, select } from '@inquirer/prompts'
import { type CreateManualAccountBody, LunchMoneyError, type ManualAccount } from '@lunch-money/lunch-money-js-v2'
import { details, error, info } from '@repo/logger'
import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'

import type { AccountStatus } from './money-forward/3rdparty/scrapers/registered-accounts.ts'
import { mfUrls } from './money-forward/3rdparty/urls.ts'
import { db, lm } from './setup.ts'
import type { Account } from './types.ts'

const MONEY_FORWARD_INTEGRATION = 'money-forward'
const REVOLUT_INTEGRATION = 'revolut'

export async function saveAccounts(accounts: AccountStatus[]): Promise<void> {
    const filepath = 'data/money-forward/accounts.csv'

    info(`Writing accounts to CSV...`)
    const accountsCsv = stringify(accounts, {
        header: true,
        columns: ['mfId', 'name', 'type', 'status', 'lastUpdated', 'url', 'errorMessage'],
    })
    await Bun.write(filepath, accountsCsv)
    info(`Wrote ${details(accounts.length)} accounts to ${details(filepath)}`)
}

export async function loadAccounts(): Promise<AccountStatus[]> {
    const filepath = 'data/money-forward/accounts.csv'

    try {
        info(`Loading accounts from ${details(filepath)}...`)
        const file = Bun.file(filepath)

        if (!(await file.exists())) {
            info(`File ${details(filepath)} not found`)
            return []
        }

        const content = await file.text()
        const records = parse(content, {
            columns: true,
            skip_empty_lines: true,
            bom: true,
        }) as Array<{
            mfId: string
            name: string
            type: string
            status: string
            lastUpdated: string
            url: string
            errorMessage?: string
        }>

        const accounts: AccountStatus[] = records.map((record) => ({
            mfId: record.mfId,
            name: record.name,
            type: record.type,
            status: record.status as AccountStatus['status'],
            lastUpdated: record.lastUpdated,
            url: record.url,
            errorMessage: record.errorMessage || undefined,
        }))

        info(`Loaded ${details(accounts.length)} accounts`)
        return accounts
    } catch (error) {
        info(`Error loading accounts: ${error}`)
        return []
    }
}

export async function syncMoneyForwardAccounts() {
    const mfAccounts = await loadAccounts()
    const lmAccounts: ManualAccount[] = await lm.manualAccounts.getAll()

    const remainingLMAccounts = new Set(lmAccounts)

    let matches = db.query(`SELECT * FROM accounts WHERE integration = ?`).all(MONEY_FORWARD_INTEGRATION) as Account[]
    info('Existing Money Forward ↔ Lunch Money account mappings:')
    const lmIdToAccounts = lmAccounts.reduce(
        (acc, item) => {
            acc[item.id] = item
            return acc
        },
        {} as { [key: number]: ManualAccount }
    )
    const mfIdToAccounts = mfAccounts.reduce(
        (acc, item) => {
            acc[item.mfId] = item
            return acc
        },
        {} as { [key: string]: AccountStatus }
    )

    const unmatchedMfAccounts = new Set(mfAccounts)
    matches.forEach((it) => {
        const lmAccount = lmIdToAccounts[it.lm_id]
        const mfAccount = mfIdToAccounts[it.account_id]

        const lmAccountName = lmAccount?.display_name ?? lmAccount?.name ?? '<missing>'
        const mfAccountName = mfAccount?.name ?? '<missing>'

        if (mfAccount) {
            unmatchedMfAccounts.delete(mfAccount)
        }

        info(`↳ ${details(lmAccountName)} → ${details(mfAccountName)}`)
    })

    if (unmatchedMfAccounts.size > 0) {
        info('Unmapped Money Forward accounts:')
        unmatchedMfAccounts.values().forEach((it) => {
            const mfAccountName = it.name
            info(`↳ ${details(mfAccountName)}`)
        })
    }

    let rematch = true
    if (matches.length > 0) {
        rematch = await confirm({
            message: 'There are existing matches from a previous import. Do you want to rematch your accounts?',
            default: false,
        })
    }

    if (rematch) {
        // truncate existing matches table
        db.query(`DELETE FROM accounts WHERE integration = ?`).run(MONEY_FORWARD_INTEGRATION)

        // rematch accounts
        for (const mfAcc of mfAccounts) {
            while (true) {
                const lmChoices = [...remainingLMAccounts].map((lmAcc) => ({
                    name: lmAcc.name,
                    value: lmAcc,
                    description: `${lmAcc.type}`,
                }))
                let matchAnswer = await select({
                    message: `Which Lunch Money account matches ${mfAcc.name} - ${mfUrls.withPath(mfAcc.url)}?`,
                    choices: [
                        { name: 'Create new account', value: undefined },
                        new Separator(),
                        ...lmChoices,
                        new Separator(),
                        { name: 'N/A (skip)', value: null },
                    ],
                })

                // HACK
                if (matchAnswer === undefined) {
                    const name = await input({
                        message: 'Account name',
                        required: true,
                        default: mfAcc.name,
                        prefill: 'editable',
                    })
                    const type = (await select({
                        message: 'Account type',
                        choices: [
                            'cash',
                            'credit',
                            'cryptocurrency',
                            'employee compensation',
                            'investment',
                            'loan',
                            'other liability',
                            'other asset',
                            'real estate',
                            'vehicle',
                        ],
                    })) as CreateManualAccountBody['type']

                    try {
                        matchAnswer = await lm.manualAccounts.create({
                            name,
                            type,
                            balance: 0,
                        })
                    } catch (e) {
                        if (e instanceof LunchMoneyError) {
                            error(`Error creating account: ${details(e.message)}`, e.errors)
                        } else {
                            error(`Error creating account. Please try again.`, e)
                        }
                        continue
                    }
                }

                if (matchAnswer !== null) {
                    remainingLMAccounts.delete(matchAnswer)
                    db.query(
                        'INSERT INTO accounts (integration, lm_id, account_id, account_name) VALUES (?, ?, ?, ?)'
                    ).run(MONEY_FORWARD_INTEGRATION, matchAnswer.id, mfAcc.mfId, mfAcc.name)
                }

                break
            }
        }
    }

    matches = db.query('SELECT * FROM accounts WHERE integration = ?').all(MONEY_FORWARD_INTEGRATION) as Account[]
    return matches
}

export async function syncRevolutAccounts(revolutAccounts: string[]) {
    const lmAccounts = await lm.manualAccounts.getAll()

    const remainingLMAccounts = new Set(lmAccounts)

    let matches = db.query(`SELECT * FROM accounts WHERE integration = ?`).all(REVOLUT_INTEGRATION)
    let rematch = true
    if (matches.length > 0) {
        rematch = await confirm({
            message: 'There are existing matches from a previous import. Do you want to rematch your accounts?',
            default: false,
        })
    }

    if (rematch) {
        // truncate existing matches table
        db.query(`DELETE FROM accounts WHERE integration = ?`).run(REVOLUT_INTEGRATION)

        // rematch accounts
        for (const revolutAccount of revolutAccounts) {
            while (true) {
                const lmChoices = [...remainingLMAccounts].map((lmAcc) => ({
                    name: lmAcc.name,
                    value: lmAcc,
                    description: `${lmAcc.type}`,
                }))
                let matchAnswer = await select({
                    message: `Which Lunch Money account matches ${revolutAccount}?`,
                    choices: [
                        { name: 'Create new account', value: undefined },
                        new Separator(),
                        ...lmChoices,
                        new Separator(),
                        { name: 'N/A (skip)', value: null },
                    ],
                })

                // HACK
                if (matchAnswer === undefined) {
                    const name = await input({
                        message: 'Account name',
                        required: true,
                        default: revolutAccount,
                        prefill: 'editable',
                    })
                    const type = (await select({
                        message: 'Account type',
                        choices: [
                            'cash',
                            'credit',
                            'cryptocurrency',
                            'employee compensation',
                            'investment',
                            'loan',
                            'other liability',
                            'other asset',
                            'real estate',
                            'vehicle',
                        ],
                    })) as CreateManualAccountBody['type']

                    try {
                        matchAnswer = await lm.manualAccounts.create({
                            name,
                            type,
                            balance: 0,
                        })
                    } catch (e) {
                        if (e instanceof LunchMoneyError) {
                            error(`Error creating account: ${details(e.message)}`, e.errors)
                        } else {
                            error(`Error creating account. Please try again.`, e)
                        }
                        continue
                    }
                }

                if (matchAnswer !== null) {
                    remainingLMAccounts.delete(matchAnswer)
                    db.query(
                        'INSERT INTO accounts (integration, lm_id, account_id, account_name) VALUES (?, ?, ?, ?)'
                    ).run(REVOLUT_INTEGRATION, matchAnswer.id, revolutAccount, revolutAccount)
                }

                break
            }
        }
    }

    matches = db.query('SELECT * FROM accounts WHERE integration = ?').all(REVOLUT_INTEGRATION)
    return matches as Account[]
}
