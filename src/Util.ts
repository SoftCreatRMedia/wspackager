export default class Util {
  static isTarball(filePath: string): boolean {
    const lower = filePath.toLowerCase()

    return ['.tar', '.tar.gz', '.tgz'].some((end) => lower.endsWith(end))
  }

  static isGzipTarball(filePath: string): boolean {
    const lower = filePath.toLowerCase()

    return lower.endsWith('.tar.gz') || lower.endsWith('.tgz')
  }

  static stripTarballExtension(filePath: string): string {
    return filePath.replace(/(\.tar\.gz|\.tgz|\.tar)$/i, '')
  }
}
