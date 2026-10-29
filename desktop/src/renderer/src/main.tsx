import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 挂载节点')

// 不用 StrictMode：keepalive-for-react 明确说明它无法和 StrictMode 一起工作，
// 开发模式下 effect 双执行会让缓存节点的挂载 / 卸载次数翻倍，出现重复请求、滚动位置丢失。
createRoot(container).render(
  // 打包后是 file:// 协议，只能用 HashRouter
  <HashRouter>
    <App />
  </HashRouter>
)
