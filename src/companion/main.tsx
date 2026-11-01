import { createRoot } from 'react-dom/client'
import { Companion } from './Companion'
import './companion.css'

// YouTube 小視窗（R78）：先讀回分頁與連結的格子再顯示
void window.companion.getInit().then((init) => {
  createRoot(document.getElementById('root')!).render(<Companion initial={init} />)
})
