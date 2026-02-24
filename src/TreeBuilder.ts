import Util from './Util.js'
import type { FormatterFn } from './types.js'

interface TreeNode {
  _: string[]
  [key: string]: TreeNode | string[]
}

interface Formatter {
  bold?: FormatterFn
  tar?: FormatterFn
}

const log = console.log

export function buildTree(tree: Partial<TreeNode>, item: string): TreeNode {
  if (!tree._) tree._ = []

  if (!item.includes('/')) {
    tree._.push(item)
  } else {
    const i = item.indexOf('/')
    const end = item.slice(i + 1)
    const folder = item.slice(0, i)

    if (!tree[folder] || Array.isArray(tree[folder])) {
      tree[folder] = { _: [] }
    }

    const child = tree[folder] as Partial<TreeNode>

    tree[folder] = buildTree(child, end)
  }

  return tree as TreeNode
}

export function outputTree(
  tree: TreeNode,
  level = 0,
  levelsDone: number[] = [],
  formatter: Formatter = {}
): void {
  const formatBold = formatter.bold || ((value: string) => value)
  const formatTar = formatter.tar || ((value: string) => value)
  const files = tree._.concat(Object.keys(tree).filter((item) => item !== '_')).sort()

  files.forEach((item, key) => {
    const value = tree[item]
    const isFolder = Boolean(item !== '_' && value && !Array.isArray(value))
    const isLastEntry = key === files.length - 1
    const symbol = isLastEntry ? '└' : '├'
    let prefix = ''

    for (let i = 0; i < level; i++) {
      prefix += levelsDone.includes(i) ? '    ' : '│   '
    }

    const itemText = isFolder ? formatBold(item) : Util.isTarball(item) ? formatTar(item) : item

    log(`${prefix}${symbol}── ${itemText}`)

    if (isFolder) {
      if (isLastEntry) {
        levelsDone.push(level)
      }

      outputTree(value as TreeNode, level + 1, levelsDone, formatter)
    }
  })
}
