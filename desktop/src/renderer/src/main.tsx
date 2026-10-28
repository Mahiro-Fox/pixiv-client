import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 挂载节点')

createRoot(container).render(
  <StrictMode>
    {/* 打包后是 file:// 协议，只能用 HashRouter */}
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
)
