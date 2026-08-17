import { execFileSync } from 'node:child_process'

/** Run a tool with one argument or a list of arguments. */
export function runTool(command, argument) {
  const args = Array.isArray(argument) ? argument : [argument]
  return execFileSync(command, args, { encoding: 'utf8' }).trim()
}
