import type { Locator } from '@playwright/test'

/** Picks `value` in a custom Select (ui/Select.tsx): opens it, then clicks the matching option. */
export async function choose(select: Locator, value: string): Promise<void> {
  await select.click()
  await select.page().locator(`[role="listbox"] [role="option"][data-value="${value}"]`).click()
}

/** The enabled option labels of a custom Select (opens it and closes it again). */
export async function optionLabels(select: Locator): Promise<string[]> {
  await select.click()
  const labels = await select.page().locator('[role="listbox"] [role="option"]:not([aria-disabled]) .msel-label').allTextContents()
  await select.press('Escape')
  return labels
}
