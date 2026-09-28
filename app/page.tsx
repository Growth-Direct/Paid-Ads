'use client'

import BuyerTab from '@/components/buyer/BuyerTab'
import BudgetPacingTab from '@/components/budget/BudgetPacingTab'
import SellerTab from '@/components/seller/SellerTab'
import Footer from '@/components/shared/Footer'
import Nav, { type NavView } from '@/components/shared/Nav'
import type { BuyerFactsResponse } from '@/lib/buyer/aggregate'
import { quarterEndOfIST, quarterStartOfIST } from '@/lib/buyer/shared'
import { type TimeRange } from '@/lib/buyer/timePresets'
import { QUARTER_START_ISO } from '@/lib/buyer/types'
import type { SellerFactsResponse } from '@/lib/seller/aggregate'
import { useHashState } from '@/lib/useHashState'
import { useMemo, useState } from 'react'
import useSWR from 'swr'

const fetcher = (url: string) =>
    fetch(url).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
    })

export default function Home() {
    const [view, setView] = useHashState('view', 'buyer')
    const activeView = (view as NavView) || 'buyer'

    // Buyer and seller keep independent time selections. Empty means each tab's reporting
    // quarter, which is what it opens on.
    const [buyerPeriods, setBuyerPeriods] = useState<TimeRange[]>([])
    const [sellerPeriods, setSellerPeriods] = useState<TimeRange[]>([])

    // The fetch window is the selected range snapped out to whole quarters, so paging
    // between quarters reuses the cache instead of refetching a slightly different slice.
    const buyerKey = useMemo(() => {
        if (buyerPeriods.length === 0) return '/api/buyer'
        const starts = buyerPeriods.map((p) => new Date(p.start!).getTime())
        const ends = buyerPeriods.map((p) => new Date(p.end!).getTime())
        const winStart = quarterStartOfIST(new Date(Math.min(...starts)))
        const winEnd = quarterEndOfIST(new Date(Math.max(...ends) - 1))
        const rqStart = quarterStartOfIST(new Date(QUARTER_START_ISO))
        const rqEnd = quarterEndOfIST(new Date(QUARTER_START_ISO))
        if (winStart.getTime() === rqStart.getTime() && winEnd.getTime() === rqEnd.getTime()) return '/api/buyer'
        return `/api/buyer?start=${encodeURIComponent(winStart.toISOString())}&end=${encodeURIComponent(winEnd.toISOString())}`
    }, [buyerPeriods])

    // The bare /api/seller endpoint returns the seller reporting quarter, which is now the same
    // calendar quarter as the buyer tab (changed 2026-09-09 — see SELLER_QUARTER_START_ISO's doc
    // comment), so the default view and a picked period both snap to the same calendar-quarter
    // bounds.
    const sellerKey = useMemo(() => {
        if (sellerPeriods.length === 0) return '/api/seller'
        const starts = sellerPeriods.map((p) => new Date(p.start!).getTime())
        const ends = sellerPeriods.map((p) => new Date(p.end!).getTime())
        const winStart = quarterStartOfIST(new Date(Math.min(...starts)))
        const winEnd = quarterEndOfIST(new Date(Math.max(...ends) - 1))
        return `/api/seller?start=${encodeURIComponent(winStart.toISOString())}&end=${encodeURIComponent(winEnd.toISOString())}`
    }, [sellerPeriods])

    const buyer = useSWR<BuyerFactsResponse>(buyerKey, fetcher, {
        refreshInterval: 300_000,
        keepPreviousData: true,
    })
    // Only fetched while the seller tab is active, so opening the buyer tab does not pay for a
    // seller Zoho build it isn't showing. The buyer hook above is unchanged.
    const seller = useSWR<SellerFactsResponse>(activeView === 'seller' ? sellerKey : null, fetcher, {
        refreshInterval: 300_000,
        keepPreviousData: true,
    })

    const cachedAt = activeView === 'seller' ? seller.data?.cachedAt : buyer.data?.cachedAt

    return (
        <>
            <Nav activeView={activeView} onViewChange={(v) => setView(v)} />
            <div style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 40px 60px' }}>
                {activeView === 'seller' ? (
                    seller.error ? (
                        <div style={{ color: '#DC2626', fontSize: 13 }}>Failed to load: {seller.error.message}</div>
                    ) : seller.isLoading || !seller.data ? (
                        <div style={{ color: '#333333', fontSize: 13 }}>Loading…</div>
                    ) : (
                        <SellerTab
                            response={seller.data}
                            periods={sellerPeriods}
                            onPeriods={setSellerPeriods}
                            loading={seller.isValidating}
                        />
                    )
                ) : buyer.error ? (
                    <div style={{ color: '#DC2626', fontSize: 13 }}>Failed to load: {buyer.error.message}</div>
                ) : buyer.isLoading || !buyer.data ? (
                    <div style={{ color: '#333333', fontSize: 13 }}>Loading…</div>
                ) : activeView === 'budget' ? (
                    // Reuses the already-fetched Buyer facts — no new Zoho fetch, no new API route.
                    <BudgetPacingTab response={buyer.data} />
                ) : (
                    <BuyerTab
                        response={buyer.data}
                        periods={buyerPeriods}
                        onPeriods={setBuyerPeriods}
                        loading={buyer.isValidating}
                    />
                )}
            </div>
            <Footer cachedAt={cachedAt} />
        </>
    )
}
