import { STRINGS } from './strings.mjs'
import languages from './locales/languages.mjs'
const english = Object.fromEntries(STRINGS.map(value => [value, value]))
let dictionary = english, language = 'en', generation = 0
export const LANGUAGES = languages
export const getLanguage = () => language
export function translate(value, variables = {}) {
  let output = dictionary[value] || english[value] || value
  for (const [key, text] of Object.entries(variables)) output = output.replaceAll(`{${key}}`, String(text))
  return output
}
export const t = translate
export function languageName(code, native = true) {
  const item = languages.find(item => item.code === code)
  try { return new Intl.DisplayNames([native ? code : language], { type: 'language' }).of(code) || item?.name || code } catch { return item?.name || code }
}
export async function setLanguage(value) {
  const request = ++generation
  const item = languages.find(item => item.code.toLowerCase() === String(value).toLowerCase()) || languages.find(item => item.code === String(value).split('-')[0]) || languages.find(item => item.code.split('-')[0] === String(value).split('-')[0])
  const code = item?.code || 'en'
  const next = code === 'en' ? english : (await import(`./locales/${code}.mjs`)).default
  if (request !== generation) return
  dictionary = next; language = code
  document.documentElement.lang = code
  document.documentElement.dir = ['ar','fa','he','ur','ps','sd','ug','yi','ckb','dv'].includes(code) ? 'rtl' : 'ltr'
  try { localStorage.setItem('fsd-language', code) } catch { /* optional preference */ }
  translatePage()
  document.dispatchEvent(new CustomEvent('language-changed'))
}
export function translatePage(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n)
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder))
  for (const node of root.querySelectorAll('[data-i18n-aria]')) node.setAttribute('aria-label', t(node.dataset.i18nAria))
}
let initial = navigator.language || 'en'
try { initial = localStorage.getItem('fsd-language') || initial } catch { /* browser storage may be unavailable */ }
try { await setLanguage(initial) } catch { await setLanguage('en') }
