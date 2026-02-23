import { Glob } from 'bun'
import { details, error, info, warn } from '@repo/logger'
import { parse } from 'csv-parse/sync'

export enum RevolutTransactionType {
    CARD_PAYMENT = 'Card Payment',
    CARD_REFUND = 'Card Refund',
    CHARGE = 'Charge',
    EXCHANGE = 'Exchange',
    REFUND = 'Refund',
    REWARD = 'Reward',
    TOPUP = 'Topup',
    TRANSFER = 'Transfer',
}

export enum RevolutTransactionState {
    COMPLETED = 'COMPLETED',
    PENDING = 'PENDING',
    REVERTED = 'REVERTED',
}

export interface RevolutTransaction {
    externalId: string
    type: RevolutTransactionType
    product: string
    startedDate: string
    completedDate: string
    description: string
    amount: number
    fee: number
    currency: string
    state: RevolutTransactionState
    balance: number
}

interface ValidationError {
    filename: string
    recordIndex: number
    field: string
    value: string
    message: string
}

function generateExternalId(product: string, description: string, startedDate: string, completedDate: string): string {
    const data = `${product}|${description}|${startedDate}|${completedDate}`
    return new Bun.CryptoHasher('sha256').update(data).digest('hex')
}

function validateTransactionType(type: string): type is RevolutTransactionType {
    return Object.values(RevolutTransactionType).includes(type as RevolutTransactionType)
}

function validateTransactionState(state: string): state is RevolutTransactionState {
    return Object.values(RevolutTransactionState).includes(state as RevolutTransactionState)
}

function validateRecord(
    record: Record<string, string>,
    filename: string,
    index: number,
    errors: ValidationError[]
): RevolutTransaction | null {
    const type = record.Type || ''
    const state = record.State || ''
    let hasError = false

    if (!validateTransactionType(type)) {
        errors.push({
            filename,
            recordIndex: index,
            field: 'Type',
            value: type,
            message: `Invalid transaction type. Expected one of: ${Object.values(RevolutTransactionType).join(', ')}`,
        })
        hasError = true
    }

    if (!validateTransactionState(state)) {
        errors.push({
            filename,
            recordIndex: index,
            field: 'State',
            value: state,
            message: `Invalid transaction state. Expected one of: ${Object.values(RevolutTransactionState).join(', ')}`,
        })
        hasError = true
    }

    const amount = parseFloat(record.Amount || '0')
    const fee = parseFloat(record.Fee || '0')
    const balance = parseFloat(record.Balance || '0')

    if (Number.isNaN(amount)) {
        errors.push({
            filename,
            recordIndex: index,
            field: 'Amount',
            value: record.Amount || '',
            message: 'Amount must be a valid number',
        })
        hasError = true
    }

    if (Number.isNaN(fee)) {
        errors.push({
            filename,
            recordIndex: index,
            field: 'Fee',
            value: record.Fee || '',
            message: 'Fee must be a valid number',
        })
        hasError = true
    }

    if (Number.isNaN(balance)) {
        errors.push({
            filename,
            recordIndex: index,
            field: 'Balance',
            value: record.Balance || '',
            message: 'Balance must be a valid number',
        })
        hasError = true
    }

    if (hasError) {
        return null
    }

    const product = record.Product || ''
    const description = record.Description || ''
    const startedDate = record['Started Date'] || ''
    const completedDate = record['Completed Date'] || ''

    return {
        externalId: generateExternalId(product, description, startedDate, completedDate),
        type: type as RevolutTransactionType,
        product,
        startedDate,
        completedDate,
        description,
        amount,
        fee,
        currency: record.Currency || '',
        state: state as RevolutTransactionState,
        balance,
    }
}

export async function loadTransactions(): Promise<RevolutTransaction[]> {
    const transactions: RevolutTransaction[] = []
    const validationErrors: ValidationError[] = []
    const glob = new Glob('*.csv')
    const dataDir = 'data/revolut'

    const files = Array.from(glob.scanSync(dataDir))

    if (files.length === 0) {
        info(`No CSV files found in ${dataDir}`)
        return transactions
    }

    for (const filename of files) {
        const filepath = `${dataDir}/${filename}`

        try {
            info(`Loading ${details(filename)}...`)
            const file = Bun.file(filepath)

            if (!(await file.exists())) {
                warn(`File ${details(filename)} not found, skipping`)
                continue
            }

            const content = await file.text()
            const records = parse(content, {
                columns: true,
                skip_empty_lines: true,
                bom: true,
            }) as Record<string, string>[]

            records.forEach((record, i) => {
                const validatedRecord = validateRecord(record, filename, i + 1, validationErrors)
                if (validatedRecord) {
                    transactions.push(validatedRecord)
                }
            })

            const validCount = records.length - validationErrors.filter((e) => e.filename === filename).length
            info(`Loaded ${details(validCount)} valid transactions from ${details(filename)}`)
        } catch (error) {
            info(`Error loading ${details(filename)}: ${details(error)}`)
        }
    }

    if (validationErrors.length > 0) {
        error(`Validation errors found (${details(validationErrors.length)} total):`)
        for (const e of validationErrors) {
            error(
                `  ${details(e.filename)}:${details(e.recordIndex)} - ${details(e.field)}: ${details(e.message)} (value: "${details(e.value)}")`
            )
        }
    }

    info(`Total valid transactions loaded: ${details(transactions.length)}`)
    return transactions
}
