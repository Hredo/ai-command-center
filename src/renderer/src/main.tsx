import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// La ventanita del prompt rápido carga este mismo código con #quick: sólo su
// vista, sin el motor de la ventana principal.
const QuickPrompt = lazy(() => import('./QuickPrompt'))
const quick = window.location.hash === '#quick'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {quick ? (
      <Suspense fallback={null}>
        <QuickPrompt />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>
)
