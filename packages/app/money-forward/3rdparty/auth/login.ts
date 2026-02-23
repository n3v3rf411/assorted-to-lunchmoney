// https://github.com/hiroppy/mf-dashboard/blob/3e5ad1277055c87a76d7e69efe2fd7bd61b9165b/apps/crawler/src/auth/login.ts

import { info } from '@repo/logger'
import type { BrowserContext, Page } from 'playwright'

import { config } from '../../../setup.ts'
import { mfUrls } from '../urls.ts'
import { getOTP } from './otp.ts'
import { hasAuthState, saveAuthState } from './state.ts'

const TIMEOUTS = {
    redirect: 2000,
    short: 5000,
    medium: 10000,
    long: 15000,
    login: 30000,
}

const SELECTORS = {
    mfidEmail: 'input[name="mfid_user[email]"]',
    mfidPassword: 'input[name="mfid_user[password]"]',
    mfidSubmit: '#submitto',
    mfidOtpInput: 'input[autocomplete="one-time-code"], input[name*="otp"], input[name*="code"]',
    mfidOtpSubmit: '#submitto, button:text-is("認証する"), button:text-is("Verify")',
    mePassword: 'input[type="password"]',
    meSignIn: 'button:has-text("Sign in")',
}

function isLoggedInUrl(url: string): boolean {
    return url.includes('moneyforward.com') && !url.includes('id.moneyforward.com') && !url.includes('/sign_in')
}

function buildAccountSelector(username: string): string {
    return `button:has-text("${username}"), button:has-text("メールアドレスでログイン"), button:has-text("Sign in with email")`
}

async function waitForUrlChange(page: Page, timeout: number = TIMEOUTS.redirect): Promise<void> {
    const initialUrl = page.url()
    try {
        await page.waitForURL((url) => url.toString() !== initialUrl, { timeout })
    } catch {
        // Ignore timeout: no redirect happened
    }
}

async function maybeHandleOtp(
    page: Page,
    {
        inputSelector,
        submitSelector,
        label,
        timeout = TIMEOUTS.short,
    }: {
        inputSelector: string
        submitSelector: string
        label: string
        timeout?: number
    }
): Promise<void> {
    try {
        info(`Checking for ${label} OTP...`)
        const otpInput = page.locator(inputSelector).first()
        await otpInput.waitFor({ state: 'visible', timeout })

        info(`${label} OTP required, getting from 1Password...`)
        const otp = getOTP()
        await otpInput.fill(otp)
        info('Clicking verify button...')
        await page.locator(submitSelector).first().click()
    } catch {
        info(`${label} OTP not required`)
    }
}

/**
 * Check if the current session is valid by navigating to Money Forward
 * and checking if we're redirected to login page
 */
async function isSessionValid(page: Page): Promise<boolean> {
    info('Checking if session is valid...')

    try {
        // Navigate to Money Forward home
        await page.goto(mfUrls.home, {
            waitUntil: 'domcontentloaded',
            timeout: TIMEOUTS.long,
        })

        // Wait a bit for potential redirects
        await waitForUrlChange(page)

        const currentUrl = page.url()
        info('Current URL after navigation:', currentUrl)

        // If we're on the main site (not login/id page), session is valid
        if (isLoggedInUrl(currentUrl)) {
            info('Session is valid!')
            return true
        }

        info('Session is invalid, need to login')
        return false
    } catch (err) {
        info('Error checking session:', err)
        return false
    }
}

/**
 * Login with auth state if available, otherwise perform full login
 */
export async function loginWithAuthState(page: Page, context: BrowserContext): Promise<void> {
    // If auth state exists, check if session is valid
    if (hasAuthState()) {
        info('Auth state found, checking session validity...')

        const valid = await isSessionValid(page)
        if (valid) {
            info('Using existing session from auth state')
            return
        }

        info('Session expired, performing full login...')
    } else {
        info('No auth state found, performing full login...')
    }

    // Perform full login
    await login(page)

    // Save auth state after successful login
    await saveAuthState(context)
}

export async function login(page: Page): Promise<void> {
    info('Navigating to login page...')
    await page.goto(mfUrls.auth.signIn, {
        waitUntil: 'domcontentloaded',
    })

    // Enter email
    info('Entering email...')
    const emailInput = page.locator(SELECTORS.mfidEmail)
    await emailInput.waitFor({ state: 'visible', timeout: TIMEOUTS.medium })
    await emailInput.fill(config.moneyForward.emailAddress)

    // Click sign in button
    info('Clicking Sign in button...')
    await page.locator(SELECTORS.mfidSubmit).click()

    // Wait for password field
    info('Waiting for password page...')
    const passwordInput = page.locator(SELECTORS.mfidPassword)
    await passwordInput.waitFor({ state: 'visible', timeout: TIMEOUTS.medium })

    // Enter password
    info('Entering password...')
    await passwordInput.fill(config.moneyForward.password)
    info('Clicking Sign in button...')
    await page.locator(SELECTORS.mfidSubmit).click()

    // Check if OTP is required
    await maybeHandleOtp(page, {
        inputSelector: SELECTORS.mfidOtpInput,
        submitSelector: SELECTORS.mfidOtpSubmit,
        label: 'MFID',
    })

    // Wait for redirect after login
    info('Waiting for login to complete...')
    await page.waitForURL(/https:\/\/(id\.)?moneyforward\.com\/.*/, {
        timeout: TIMEOUTS.login,
    })

    // Navigate to Money Forward ME - will redirect to MFID for auth
    info('Navigating to Money Forward ME...')
    // Don't wait for full load, just start navigation
    await page.goto(mfUrls.signIn)

    // Wait a bit for redirect to start
    await waitForUrlChange(page)

    // If we're still on the ME domain, we might be logged in or need more time
    let currentUrl = page.url()
    info('URL after initial wait:', currentUrl)
    if (currentUrl.startsWith(mfUrls.signIn)) {
        // Wait for redirect to MFID
        info('Waiting for MFID redirect...')
        await page.waitForURL(/id\.moneyforward\.com/, {
            timeout: TIMEOUTS.long,
        })
        currentUrl = page.url()
    }

    info('Current URL:', currentUrl)

    // Check if already on ME home (session is valid)
    if (isLoggedInUrl(currentUrl)) {
        info('Already logged in to ME!')
        return
    }

    // Check if we're on account selector or password page
    if (currentUrl.includes('account_selector')) {
        // Click account button (contains email address)
        info('Account selector found, clicking account...')
        // Try multiple selectors: email address, or Japanese/English text
        const accountButton = page.locator(buildAccountSelector(config.moneyForward.emailAddress)).first()
        await accountButton.waitFor({ state: 'visible', timeout: TIMEOUTS.short })

        // Click and wait for navigation (either to password page or directly to ME)
        info('Clicking account and waiting for navigation...')
        await accountButton.click()

        // Wait for either password page or direct redirect to ME
        await page.waitForURL(/id\.moneyforward\.com\/sign_in\/password|moneyforward\.com\//, {
            timeout: TIMEOUTS.long,
        })
        currentUrl = page.url()
    }

    // Check if we need to enter password or already redirected to ME
    if (currentUrl.includes(mfUrls.auth.password)) {
        // Wait for password page
        info('Waiting for ME password page...')
        const mePasswordInput = page.locator(SELECTORS.mePassword).first()
        await mePasswordInput.waitFor({ state: 'visible', timeout: TIMEOUTS.medium })

        // Enter password
        info('Entering ME password...')
        await mePasswordInput.fill(config.moneyForward.password)

        // Click Sign in button
        info('Clicking Sign in button...')
        await page.locator(SELECTORS.meSignIn).click()

        // Wait for redirect to ME
        info('Waiting for ME redirect...')
        await page.waitForURL(`${mfUrls.home}**`, { timeout: TIMEOUTS.login })
    } else {
        info('Already redirected to ME (session exists)')
    }

    info('Login successful!')
}
