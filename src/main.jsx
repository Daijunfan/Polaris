import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { initTheme } from './theme.js'
import { ThemeProvider } from './theme-hook.jsx'
import {ToastProvider} from './toast.jsx'
import {WorkspaceProvider} from './workspace.jsx'
import {PolarisProvider} from './insights.jsx'

initTheme()

createRoot(document.getElementById('root')).render(<ThemeProvider><ToastProvider><WorkspaceProvider><PolarisProvider><App/></PolarisProvider></WorkspaceProvider></ToastProvider></ThemeProvider>)
