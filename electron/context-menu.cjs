const { Menu } = require('electron')

module.exports = function installContextMenu(window, language) {
  window.webContents.on('context-menu', (_event, params) => {
    if (params.frame !== window.webContents.mainFrame) return
    const english = language() !== 'de'
    const item = (role, de, en, enabled = true) => ({ role, label: english ? en : de, enabled })
    const flags = params.editFlags
    const template = params.isEditable ? [
      item('undo', 'Rückgängig', 'Undo', flags.canUndo),
      item('redo', 'Wiederholen', 'Redo', flags.canRedo),
      { type: 'separator' },
      item('cut', 'Ausschneiden', 'Cut', flags.canCut),
      item('copy', 'Kopieren', 'Copy', flags.canCopy),
      item('paste', 'Einfügen', 'Paste', flags.canPaste),
      { type: 'separator' },
      item('selectAll', 'Alles auswählen', 'Select all', flags.canSelectAll),
    ] : params.selectionText ? [item('copy', 'Kopieren', 'Copy', flags.canCopy)] : []
    if (template.length) Menu.buildFromTemplate(template).popup({ window, frame: params.frame })
  })
}
