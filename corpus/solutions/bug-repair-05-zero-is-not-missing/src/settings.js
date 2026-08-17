/** Read a setting, falling back when it is absent. */
export function settingOr(settings, key, fallback) {
  return settings[key] === undefined ? fallback : settings[key]
}
