import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// 先讀回上次的設定再顯示畫面，避免先出現預設版型再跳成上次的版型（R10）
void window.multiview.getView().then((view) => {
  createRoot(document.getElementById('root')!).render(<App initial={view} />)
})
