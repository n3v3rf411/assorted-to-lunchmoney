// https://github.com/hiroppy/mf-dashboard/blob/3e5ad1277055c87a76d7e69efe2fd7bd61b9165b/apps/crawler/src/auth/state.ts

import { existsSync } from 'node:fs'
import path from 'node:path'
import { details, info } from '@repo/logger'
import type { BrowserContext } from 'playwright'

// Auth state file path
const AUTH_STATE_PATH = path.join('data', 'auth-state.json')

export function getAuthStatePath(): string {
    return AUTH_STATE_PATH
}

export function hasAuthState(): boolean {
    return existsSync(AUTH_STATE_PATH)
}

export async function saveAuthState(context: BrowserContext): Promise<void> {
    await context.storageState({ path: AUTH_STATE_PATH })
    info(`Auth state saved to ${details(AUTH_STATE_PATH)}`)
}
