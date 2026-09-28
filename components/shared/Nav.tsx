'use client'

export type NavView = 'buyer' | 'seller' | 'budget'

interface NavProps {
    activeView: NavView
    onViewChange: (view: NavView) => void
}

const tabs: { key: NavView; label: string }[] = [
    { key: 'buyer', label: 'Buyer' },
    { key: 'seller', label: 'Seller' },
    { key: 'budget', label: 'Budget Pacing' },
]

export default function Nav({ activeView, onViewChange }: NavProps) {
    return (
        <div
            style={{
                borderBottom: '1px solid #CCCCCC',
                background: '#FFFFFF',
                position: 'sticky',
                top: 0,
                zIndex: 50,
            }}>
            <div
                style={{
                    maxWidth: 1280,
                    margin: '0 auto',
                    padding: '16px 40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <img src="/truva-logo-black.svg" alt="Truva" width={28} height={28} />
                        <span style={{ width: 1, height: 18, background: '#CCCCCC' }} />
                        <span
                            style={{
                                fontSize: 13,
                                fontWeight: 600,
                                letterSpacing: '0.02em',
                                color: '#000000',
                            }}>
                            Growth Reporting
                        </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 12 }}>
                        {tabs.map((tab) => (
                            <button
                                key={tab.key}
                                onClick={() => onViewChange(tab.key)}
                                style={{
                                    background: activeView === tab.key ? '#E6F0FF' : 'none',
                                    border: activeView === tab.key ? '1px solid #0067FF' : '1px solid transparent',
                                    borderRadius: 8,
                                    padding: '6px 14px',
                                    fontSize: 13,
                                    fontWeight: activeView === tab.key ? 600 : 400,
                                    color: activeView === tab.key ? '#0067FF' : '#333333',
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                    transition: 'all 0.15s',
                                }}>
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
