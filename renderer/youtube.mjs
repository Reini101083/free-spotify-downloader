import { setLanguage, t } from './i18n.mjs'
const $ = selector => document.querySelector(selector)
await setLanguage(new URLSearchParams(location.search).get('language') || 'en')
$('#confirm').addEventListener('click', () => { $('#confirm').disabled=true; void window.youtubeConfirmation.confirm().catch(error=>{ $('#confirm').disabled=false; $('#hint').textContent=error.message }) })
$('#close').addEventListener('click', () => window.youtubeConfirmation.close())
window.youtubeConfirmation.origin(origin => { $('#origin').textContent = origin })
window.youtubeConfirmation.failure(() => { $('#hint').textContent = t('YouTube could not be loaded. Check your connection and reopen this window.') })
new ResizeObserver(() => window.youtubeConfirmation.layout(Math.ceil($('#toolbar').getBoundingClientRect().height))).observe($('#toolbar'))
