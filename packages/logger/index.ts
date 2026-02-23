// biome-ignore-all lint/suspicious/noExplicitAny: follow console.log signature

import chalk from 'chalk'

const log = console.log
const info = (...data: any[]) => {
    const [first, ...rest] = data
    log(chalk.blueBright(first), ...rest)
}
const warn = (...data: any[]) => {
    const [first, ...rest] = data
    log(chalk.bgYellow(first), ...rest)
}
const error = (...data: any[]) => {
    const [first, ...rest] = data
    log(chalk.bgRed(first), ...rest)
}
const details = chalk.red

export { info, warn, error, details }
