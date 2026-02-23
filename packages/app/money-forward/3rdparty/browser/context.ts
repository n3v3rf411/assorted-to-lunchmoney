// https://github.com/hiroppy/mf-dashboard/blob/3e5ad1277055c87a76d7e69efe2fd7bd61b9165b/apps/crawler/src/browser/context.ts
import type { Browser, BrowserContext } from 'playwright'

import { getAuthStatePath, hasAuthState } from '../auth/state.js'

// 共通設定を定数化
const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
const LOCALE = 'ja-JP'
const TIMEZONE = 'Asia/Tokyo'
const DEFAULT_TIMEOUT = 5000
const NAVIGATION_TIMEOUT = 30000

type CreateContextOptions = {
    /** storageStateのパスを直接指定（テスト用） */
    storageStatePath?: string
    /** trueの場合、hasAuthState()をチェックしてstorageStateを設定（本番用） */
    useAuthState?: boolean
}

export async function createBrowserContext(
    browser: Browser,
    options: CreateContextOptions = {}
): Promise<BrowserContext> {
    const { storageStatePath, useAuthState = false } = options

    // storageStateの決定
    let storageState: string | undefined
    if (storageStatePath) {
        storageState = storageStatePath
    } else if (useAuthState && hasAuthState()) {
        storageState = getAuthStatePath()
    }

    const context = await browser.newContext({
        locale: LOCALE,
        timezoneId: TIMEZONE,
        userAgent: USER_AGENT,
        storageState,
    })

    context.setDefaultTimeout(DEFAULT_TIMEOUT)
    context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT)

    return context
}
