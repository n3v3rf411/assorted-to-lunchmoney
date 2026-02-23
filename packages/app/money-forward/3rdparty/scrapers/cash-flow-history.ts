// https://github.com/hiroppy/mf-dashboard/blob/3e5ad1277055c87a76d7e69efe2fd7bd61b9165b/apps/crawler/src/scrapers/cash-flow-history.ts
// biome-ignore-all lint/style/noNonNullAssertion: 3rd party code

import { details, info } from '@repo/logger'
import iconv from 'iconv-lite'
import type { Locator, Page } from 'playwright'

import { mfUrls } from '../urls.ts'

const TEXT_TIMEOUT = 1000
const SUMMARY_TIMEOUT = 3000

async function getOptionalText(locator: Locator, timeout = TEXT_TIMEOUT): Promise<string | null> {
    if ((await locator.count()) === 0) return null
    const text = await locator.first().textContent({ timeout })
    return text?.trim() ?? ''
}

async function getOptionalAttribute(locator: Locator, name: string): Promise<string | null> {
    if ((await locator.count()) === 0) return null
    return locator.first().getAttribute(name)
}

/**
 * CSV linkから現在表示中の月を取得
 */
async function getMonthFromCsvLink(page: Page): Promise<string | null> {
    const csvLink = await getOptionalAttribute(page.locator("a[href*='/cf/csv']").first(), 'href')
    const yearMatch = csvLink?.match(/year=(\d{4})/)
    const monthMatch = csvLink?.match(/month=(\d{1,2})/)
    if (yearMatch && monthMatch) {
        return `${yearMatch[1]}-${monthMatch[1]?.padStart(2, '0')}`
    }
    return null
}

/**
 * ページから表示中の月を検出する
 */
async function detectMonth(page: Page): Promise<{ year: number; month: number }> {
    let year = new Date().getFullYear()
    let month = new Date().getMonth() + 1

    // Try 1: fc-header-title (FullCalendar style)
    const headerTitle = await getOptionalText(page.locator('.fc-header-title h2'), SUMMARY_TIMEOUT)
    let match = headerTitle?.match(/(\d{4})年(\d{1,2})月/)

    // Try 2: Look for date display in other formats
    if (!match) {
        const pageText = await getOptionalText(page.locator(".heading-small, .month-title, [class*='month']").first())
        match = pageText?.match(/(\d{4})年(\d{1,2})月/) || pageText?.match(/(\d{4})\/(\d{1,2})/)
    }

    // Try 3: Get from CSV download link URL
    if (!match) {
        const csvLink = await getOptionalAttribute(page.locator("a[href*='/cf/csv']").first(), 'href')
        const yearMatch = csvLink?.match(/year=(\d{4})/)
        const monthMatch = csvLink?.match(/month=(\d{1,2})/)
        if (yearMatch && monthMatch) {
            return { year: parseInt(yearMatch[1]!, 10), month: parseInt(monthMatch[1]!, 10) }
        }
    }

    if (match) {
        year = parseInt(match[1]!, 10)
        month = parseInt(match[2]!, 10)
    }

    return { year, month }
}

/**
 * 過去N月分の家計簿データを取得
 * UIの前月ボタンをクリックして月を切り替えながら取得
 */
export async function scrapeCashFlowHistory(page: Page, monthsToScrape: number = 24) {
    info(`Scraping cash flow history for ${details(monthsToScrape)} months...`)

    await page.goto(mfUrls.cashFlow, { waitUntil: 'domcontentloaded' })
    // テーブルが表示されるまで待機
    await page.locator('#cf-detail-table').waitFor({ state: 'visible', timeout: 10000 })

    const results: string[] = []

    for (let i = 0; i < monthsToScrape; i++) {
        const { year, month } = await detectMonth(page)
        const date = `${year}-${month.toString().padStart(2, '0')}`

        info(`Downloading %s...`, details(date))
        const filePromise = page.waitForEvent('download')
        await page.click('#js-dl-area')
        await page.click('#js-csv-dl')

        const file = await filePromise
        const path = `data/money-forward/${date}.csv`
        await file.saveAs(path)

        info(`Re-encoding %s from Shift-JIS to UTF-8...`, details(path))
        const shiftJisBuffer = await Bun.file(path).arrayBuffer()
        const utf8Content = iconv.decode(Buffer.from(shiftJisBuffer), 'shift_jis')
        await Bun.write(path, utf8Content)

        if (i < monthsToScrape - 1) {
            const currentMonth = await getMonthFromCsvLink(page)
            const prevButton = page.locator('button.fc-button-prev, span.fc-button-prev').first()
            await prevButton.click()

            // 月が変わるまで待機（CSV linkのURLパラメータで判定）
            await page.waitForFunction(
                (prevMonth) => {
                    // @ts-expect-error-next-line
                    const link = document.querySelector("a[href*='/cf/csv']")
                    if (!link) return false
                    const href = link.getAttribute('href') || ''
                    const yearMatch = href.match(/year=(\d{4})/)
                    const monthMatch = href.match(/month=(\d{1,2})/)
                    if (!yearMatch || !monthMatch) return false
                    const newMonth = `${yearMatch[1]}-${monthMatch[1].padStart(2, '0')}`
                    return newMonth !== prevMonth
                },
                currentMonth,
                { timeout: 10000 }
            )
        }
    }

    return results
}
