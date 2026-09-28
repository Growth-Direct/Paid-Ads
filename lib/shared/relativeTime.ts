/** "just now" / "5m ago" / "3h ago" / "12 Sep" — used by every "Saved …" caption next to a
 *  shared, persisted free-text or free-number field (Next Actionables, Next 2wk Target). */
export function relativeTime(iso: string): string {
    const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
    if (seconds < 60) return 'just now'
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
