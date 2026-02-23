import { info } from '@repo/logger'
import { chromium } from 'playwright'

import { saveAccounts } from './accounts.ts'
import { loginWithAuthState } from './money-forward/3rdparty/auth/login'
import { createBrowserContext } from './money-forward/3rdparty/browser/context'
import { scrapeCashFlowHistory } from './money-forward/3rdparty/scrapers/cash-flow-history.ts'
import { NO_GROUP_ID, switchGroup } from './money-forward/3rdparty/scrapers/group.ts'
import { getRegisteredAccounts } from './money-forward/3rdparty/scrapers/registered-accounts.ts'

export async function scrape() {
    const browser = await chromium.launch({
        headless: false,
    })

    const context = await createBrowserContext(browser, { useAuthState: true })
    const page = await context.newPage()

    info(`Logging into Money Forward...`)
    await loginWithAuthState(page, context)

    await switchGroup(page, NO_GROUP_ID)

    const mfAccounts = await getRegisteredAccounts(page)
    await saveAccounts(mfAccounts.accounts)

    await scrapeCashFlowHistory(page)

    info(`Closing...`)

    await browser.close()
}
