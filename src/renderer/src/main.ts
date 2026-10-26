import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

// Platform-specific styling (vibrancy, traffic-light inset) keys off <html data-platform>.
document.documentElement.dataset.platform = window.helm.platform
// Default density until settings load; App keeps it in sync with app.ui.density.
document.documentElement.dataset.density ??= 'comfortable'

export default mount(App, { target: document.getElementById('app')! })
