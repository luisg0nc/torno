import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/instrument-sans/latin-400.css'
import '@fontsource/instrument-sans/latin-500.css'
import '@fontsource/instrument-sans/latin-600.css'
import '@fontsource/martian-mono/latin-300.css'
import '@fontsource/martian-mono/latin-400.css'
import '@fontsource/martian-mono/latin-500.css'
import './styles/tokens.css'
import './styles/app.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
