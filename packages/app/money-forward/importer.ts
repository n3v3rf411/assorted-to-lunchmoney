import { details, info } from '@repo/logger'
import { parse } from 'csv-parse/sync'

export interface MoneyForwardTransaction {
    isCalculated: boolean
    // YYYY-MM-DD
    date: string
    description: string
    amount: number
    institution: string
    category: string
    subcategory: string
    memo: string
    isTransfer: boolean
    id: string
}

export async function loadTransactions(monthsToLoad: number): Promise<MoneyForwardTransaction[]> {
    const now = new Date()
    const transactions: MoneyForwardTransaction[] = []

    for (let i = 0; i < monthsToLoad; i++) {
        const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const year = targetDate.getFullYear()
        const month = String(targetDate.getMonth() + 1).padStart(2, '0')
        const filename = `${year}-${month}.csv`
        const filepath = `data/money-forward/${filename}`

        try {
            info(`Loading ${details(filename)}...`)
            const file = Bun.file(filepath)

            if (!(await file.exists())) {
                info(`File ${details(filename)} not found, skipping`)
                continue
            }

            const content = await file.text()
            const records = parse(content, {
                columns: true,
                skip_empty_lines: true,
                bom: true,
            }) as Record<string, string>[]

            const mappedRecords: MoneyForwardTransaction[] = records.map((record) => ({
                isCalculated: record.計算対象 === '1',
                date: record.日付 || '',
                description: record.内容 || '',
                amount: parseInt(record['金額（円）'] || '', 10),
                institution: record.保有金融機関 || '',
                category: record.大項目 || '',
                subcategory: record.中項目 || '',
                memo: record.メモ || '',
                isTransfer: record.振替 === '1',
                id: record.ID || '',
            }))

            transactions.push(...mappedRecords)
            info(`Loaded ${details(mappedRecords.length)} transactions from ${details(filename)}`)
        } catch (error) {
            info(`Error loading ${details(filename)}: ${details(error)}`)
        }
    }

    info(`Total transactions loaded: ${details(transactions.length)}`)
    return transactions
}
