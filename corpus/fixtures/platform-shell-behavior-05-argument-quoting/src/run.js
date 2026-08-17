import { execSync } from 'node:child_process'

/** Run a tool with one argument. */
export function runTool(command, argument) {
  return execSync(command + ' ' + argument, { encoding: 'utf8' }).trim()
}
