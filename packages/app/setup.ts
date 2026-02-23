import Database from 'bun:sqlite'
import { LunchMoneyClient } from '@lunch-money/lunch-money-js-v2'

export interface Config {
    lunchMoney: {
        apiKey: string
    }
    moneyForward: {
        emailAddress: string
        password: string
        otpAuthUri: string
    }
}

export let config: Config
export let db: Database
export let lm: LunchMoneyClient
export const setup = () => {
    config = {
        lunchMoney: {
            apiKey: readOrError('LUNCH_MONEY_API_KEY'),
        },
        moneyForward: {
            emailAddress: readOrError('MONEY_FORWARD_EMAIL_ADDRESS'),
            password: readOrError('MONEY_FORWARD_AUTH_PASSWORD'),
            otpAuthUri: readOrError('MONEY_FORWARD_OTPAUTH_URI'),
        },
    }

    db = new Database('mflm.sqlite', { create: true })

    // check if database is new
    try {
        db.query('SELECT * FROM settings').all()
    } catch (_err) {
        db.query('CREATE TABLE settings (id INTEGER PRIMARY KEY, name TEXT, value TEXT)').run()
        db.query(
            'CREATE TABLE accounts (id INTEGER PRIMARY KEY, integration TEXT, lm_id INTEGER, account_id TEXT, account_name TEXT)'
        ).run()
    }

    lm = new LunchMoneyClient({
        apiKey: config.lunchMoney.apiKey,
        baseUrl: 'https://api.lunchmoney.dev/v2', // Optional
    })

    return { db, config, lm }
}

const readOrError = (envKey: string): string => {
    const value = readOrDefault(envKey, '')
    if (value.length === 0) {
        throw new Error(`${envKey} must be set`)
    }
    return value
}

const readOrDefault = (envKey: string, defaultValue: string): string => {
    return Bun.env[envKey] || defaultValue
}
