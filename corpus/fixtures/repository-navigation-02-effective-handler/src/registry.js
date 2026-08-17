import { performSync } from './handlers/current.js'

export const handlers = new Map([['sync', performSync]])
