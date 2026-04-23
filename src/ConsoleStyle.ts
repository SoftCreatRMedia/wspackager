const supportsColor = Boolean(process.stdout && process.stdout.isTTY && !process.env.NO_COLOR)

type WrapFn = (value: string) => string

const wrap = (open: number, close: number): WrapFn => {
  return (value: string) => {
    if (!supportsColor) {
      return value
    }

    return `\u001b[${open}m${value}\u001b[${close}m`
  }
}

const bold = wrap(1, 22)
const green = wrap(32, 39)
const cyan = wrap(36, 39)
const dim = wrap(2, 22)

const ConsoleStyle = {
  bold: (value: string) => bold(String(value)),
  boldGreen: (value: string) => green(bold(String(value))),
  boldCyan: (value: string) => bold(cyan(String(value))),
  dim: (value: string) => dim(String(value)),
}

export default ConsoleStyle
