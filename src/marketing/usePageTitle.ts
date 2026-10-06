import { useEffect } from 'react'
import { brand } from '../config/brand'

/** Names the tab after the page and starts it at the top. */
export function usePageTitle(title: string) {
  useEffect(() => {
    const previousTitle = document.title
    document.title = `${title} | ${brand.name}`
    window.scrollTo(0, 0)
    return () => { document.title = previousTitle }
  }, [title])
}
