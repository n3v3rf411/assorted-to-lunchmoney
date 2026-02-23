declare module 'bun' {
    interface Env {
        LUNCH_MONEY_API_KEY?: string
        MONEYFORWARD_BASE_URL?: string
        MONEY_FORWARD_EMAIL_ADDRESS?: string
        MONEY_FORWARD_AUTH_PASSWORD?: string
        MONEY_FORWARD_OTPAUTH_URI?: string
    }
}

export interface Group {
    id: string
    name: string
    isCurrent: boolean
    lastScrapedAt?: string
}

export type Account = {
    id: number
    lm_id: number
    account_id: string
    account_name: string
}
