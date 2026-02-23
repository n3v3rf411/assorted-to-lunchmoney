// https://github.com/hiroppy/mf-dashboard/blob/3e5ad1277055c87a76d7e69efe2fd7bd61b9165b/apps/crawler/src/scrapers/group.ts

import { details, info, warn } from '@repo/logger'
import type { Page } from 'playwright'

import type { Group } from '../../../types.ts'
import { mfUrls } from '../urls.ts'

/** 「グループ選択なし」を表す特別なID */
export const NO_GROUP_ID = '0'

/** 除外すべきオプションのID（グループの追加・編集など） */
const EXCLUDED_OPTION_IDS = ['create_group']

const GROUP_SELECTOR = 'select[name="group_id_hash"]'

/** グループ選択なしかどうかを判定 */
export function isNoGroup(groupId: string): boolean {
    return groupId === NO_GROUP_ID
}

/** 有効なグループかどうかを判定（除外オプションを除く） */
function isValidGroupOption(value: string): boolean {
    return !EXCLUDED_OPTION_IDS.includes(value)
}

/**
 * ページ上のグループセレクタを取得する
 * @param page Playwrightのページオブジェクト
 * @param navigate trueの場合はhomeに遷移する
 */
async function getGroupSelector(page: Page, navigate = true) {
    const groupSelect = page.locator(GROUP_SELECTOR)
    await ensureGroupSelectorVisible(page, groupSelect, navigate)

    const exists = await groupSelect.count()
    return exists > 0 ? groupSelect : null
}

async function ensureGroupSelectorVisible(
    page: Page,
    groupSelect: ReturnType<Page['locator']>,
    navigate: boolean
): Promise<void> {
    if (!navigate) return

    const isVisible = await isGroupSelectorVisible(groupSelect)
    if (!isVisible) {
        await navigateToHomeWithRetry(page)
    }

    // グループセレクタが表示されるまで待機（存在しない場合もあるのでtry-catch）
    try {
        await groupSelect.waitFor({ state: 'visible', timeout: 5000 })
    } catch {
        // セレクタが存在しない場合は無視
    }
}

async function isGroupSelectorVisible(groupSelect: ReturnType<Page['locator']>): Promise<boolean> {
    if ((await groupSelect.count()) === 0) return false
    return groupSelect.isVisible()
}

async function navigateToHomeWithRetry(page: Page): Promise<void> {
    try {
        await page.goto(mfUrls.home, {
            waitUntil: 'domcontentloaded',
        })
    } catch (err) {
        if (page.isClosed()) throw err
        const message = err instanceof Error ? err.message : String(err)
        if (!message.includes('net::ERR_ABORTED')) {
            throw err
        }
        // Retry once if navigation was aborted by a subsequent navigation.
        await page.waitForTimeout(1000)
        await page.goto(mfUrls.home, {
            waitUntil: 'domcontentloaded',
        })
    }
}

/**
 * 全グループの一覧を取得する（「グループ選択なし」を含む）
 */
export async function getAllGroups(page: Page): Promise<Group[]> {
    info('Getting all groups from page...')

    const groupSelect = await getGroupSelector(page)
    if (!groupSelect) {
        info('Group selector not found')
        return []
    }

    const groups: Group[] = []
    const options = groupSelect.locator('option')
    const optionCount = await options.count()
    const currentValue = await groupSelect.inputValue()

    for (let i = 0; i < optionCount; i++) {
        const option = options.nth(i)
        const value = (await option.getAttribute('value')) || ''
        const text = (await option.textContent()) || ''

        // 「グループの追加・編集」などの特殊オプションを除外
        if (!isValidGroupOption(value)) {
            info(`Skipping non-group option: ${text.trim()} (${value})`)
            continue
        }

        groups.push({
            id: value,
            name: text.trim(),
            isCurrent: value === currentValue,
        })
    }

    info(`Found ${groups.length} groups`)
    return groups
}

/**
 * 現在選択中のグループを取得する
 */
export async function getCurrentGroup(page: Page): Promise<Group | null> {
    info('Getting current group from page...')

    const groupSelect = await getGroupSelector(page)
    if (!groupSelect) {
        info('Group selector not found')
        return null
    }

    try {
        const currentValue = await groupSelect.inputValue()
        const currentOption = groupSelect.locator(`option[value="${currentValue}"]`)
        const optionExists = await currentOption.count()

        if (optionExists > 0) {
            const name = (await currentOption.textContent({ timeout: 1000 })) || ''
            return { id: currentValue, name: name.trim(), isCurrent: true }
        }
        return null
    } catch (err) {
        info('Failed to get current group:', err)
        return null
    }
}

/**
 * 指定したグループに切り替える
 * @param page Playwrightのページオブジェクト
 * @param groupId 切り替え先のグループID（空文字列で「グループ選択なし」）
 * @returns 切り替え後のグループ情報
 */
export async function switchGroup(page: Page, groupId: string): Promise<Group | null> {
    const groupName = isNoGroup(groupId) ? 'グループ選択なし' : groupId
    info(`Switching to group: ${details(groupName)}`)

    const groupSelect = await getGroupSelector(page)
    if (!groupSelect) {
        throw new Error('Group selector not found')
    }

    // 現在の値と同じ場合は何もしない
    const currentValue = await groupSelect.inputValue()
    if (currentValue === groupId) {
        info('Already on the target group')
        return getCurrentGroup(page)
    }

    // グループを切り替え
    await groupSelect.selectOption({ value: groupId })

    // ページ遷移またはリロードを待つ
    await page.waitForLoadState('domcontentloaded')
    // グループセレクタが更新されるまで待機
    await page.locator('select[name="group_id_hash"]').waitFor({ state: 'visible', timeout: 5000 })

    // 切り替え完了の確認（alertやnotificationの表示を待つ）
    // MoneyForwardはページ遷移で切り替わるので、新しいページでセレクタを確認
    const newGroupSelect = await getGroupSelector(page, false)
    if (!newGroupSelect) {
        throw new Error('Group selector not found after switch')
    }

    const newValue = await newGroupSelect.inputValue()
    if (newValue !== groupId) {
        throw new Error(`Group switch failed: expected ${groupId}, got ${newValue}`)
    }

    info(`Successfully switched to group: ${details(groupName)}`)
    return getCurrentGroup(page)
}

/**
 * グループスコープを作成（`await using` 用）
 */
export async function createGroupScope(page: Page): Promise<AsyncDisposable & { originalGroup: Group | null }> {
    const originalGroup = await getCurrentGroup(page)

    return {
        originalGroup,
        [Symbol.asyncDispose]: async () => {
            if (originalGroup) {
                try {
                    info(`Restoring original group: ${details(originalGroup.name)}`)
                    await switchGroup(page, originalGroup.id)
                } catch (err) {
                    warn('Failed to restore original group:', err)
                }
            }
        },
    }
}
