/** Run in the page: opens a modal dialog with a focused field on top of whatever is open (like Reauth on a disconnect). */
export const stackDialog = (): void => {
  const d = document.createElement('dialog')
  d.id = 'on-top'
  d.innerHTML = '<input aria-label="On top">'
  document.body.append(d)
  d.showModal()
}
