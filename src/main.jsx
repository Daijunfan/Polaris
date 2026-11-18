import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import {WorkspaceProvider} from './workspace.jsx'
import {PolarisProvider} from './insights.jsx'

createRoot(document.getElementById('root')).render(<WorkspaceProvider><PolarisProvider><App/></PolarisProvider></WorkspaceProvider>)
