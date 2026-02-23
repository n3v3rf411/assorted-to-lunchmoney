import * as OTPAuth from 'otpauth'

import { config } from '../../../setup.ts'

export const getOTP = (): string => {
    const totp = OTPAuth.URI.parse(config.moneyForward.otpAuthUri)
    return totp.generate()
}
