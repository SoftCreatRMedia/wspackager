import TaskRunner from './TaskRunner.js'
import type { RunResult, RunnerOptions } from './types.js'

export async function run(options: Partial<RunnerOptions>): Promise<RunResult> {
  return new TaskRunner(options).run()
}

const api = { run }

export default api
