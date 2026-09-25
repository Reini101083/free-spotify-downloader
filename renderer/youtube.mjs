const $ = selector => document.querySelector(selector)
if (new URLSearchParams(location.search).get('language') === 'en') {
  document.documentElement.lang = 'en'
  $('#title').textContent = 'Confirm YouTube manually'; $('#close').textContent = 'Close'; $('#confirm').textContent = 'Use this session'
  $('#hint').textContent = 'Complete the confirmation yourself below. “Use this session” enables these YouTube cookies for local downloads until the app closes. Then resume in the main window.'
}
$('#confirm').addEventListener('click', () => window.youtubeConfirmation.confirm())
$('#close').addEventListener('click', () => window.youtubeConfirmation.close())
window.youtubeConfirmation.origin(origin => { $('#origin').textContent = origin })
window.youtubeConfirmation.failure(() => { $('#hint').textContent = document.documentElement.lang === 'en' ? 'YouTube could not be loaded. Check your connection and reopen this window.' : 'YouTube konnte nicht geladen werden. Prüfe die Verbindung und öffne das Fenster erneut.' })
