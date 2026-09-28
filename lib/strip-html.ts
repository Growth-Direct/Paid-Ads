export function stripHtml(html: string | null): string | null {
    if (!html) return null
    const stripped = html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .trim()
    return stripped || null
}
