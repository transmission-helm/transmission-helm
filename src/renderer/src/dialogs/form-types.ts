/** Shared by the option forms (DaemonOptionsForm, AppOptionsForm) and the pages hosting them. */
export type FormLayout = 'dialog' | 'page'

export interface FormSection {
  /** Element id of the section in the page layout (e.g. `download` → `#download`). */
  id: string
  label: string
}
