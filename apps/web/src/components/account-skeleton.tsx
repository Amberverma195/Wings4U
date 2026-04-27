import { AuthShellSkeleton } from "./auth-shell-skeleton";

export function AccountSkeleton({ isLoggingOut }: { isLoggingOut?: boolean }) {
  if (isLoggingOut) {
    return <AuthShellSkeleton />;
  }

  return (
    <div className="wk-account-skeleton" style={{ minHeight: '100vh', backgroundColor: '#F8C676', paddingBottom: '4rem' }}>
      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '3rem 1.5rem', fontFamily: '"DM Sans", system-ui, sans-serif' }}>
        <div className="wk-account-main-grid" style={{ display: 'grid', gap: '2rem', alignItems: 'start' }}>
          {/* Sidebar Skeleton */}
          <aside style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ background: 'white', borderRadius: '24px', border: '1px solid #e5e7eb', padding: '2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.02)' }}>
              <div className="wk-skeleton-block" style={{ height: '36px', width: '60%', borderRadius: '8px', marginBottom: '1rem', marginTop: '0.5rem' }} />
              <div className="wk-skeleton-block" style={{ height: '20px', width: '80%', borderRadius: '6px', marginBottom: '2.5rem' }} />
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: '1px solid #f3f4f6', paddingTop: '1.5rem' }}>
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="wk-skeleton-block" style={{ height: '44px', width: '100%', borderRadius: '12px' }} />
                ))}
              </div>
            </div>
          </aside>
          
          {/* Main Content Skeleton */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ background: 'white', borderRadius: '24px', border: '1px solid #e5e7eb', padding: '2.25rem', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.02)' }}>
              <div className="wk-skeleton-block" style={{ height: '14px', width: '120px', borderRadius: '4px', marginBottom: '0.5rem' }} />
              <div className="wk-skeleton-block" style={{ height: '32px', width: '220px', borderRadius: '6px', marginBottom: '2rem' }} />
              
              <div className="wk-account-rewards-grid" style={{ display: 'grid', gap: '2rem', alignItems: 'center', padding: '2rem', background: '#fafafa', borderRadius: '20px', border: '1px solid #f3f4f6' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <div className="wk-skeleton-block" style={{ height: '48px', width: '100px', borderRadius: '8px' }} />
                  <div className="wk-skeleton-block" style={{ height: '12px', width: '80px', borderRadius: '4px', marginTop: '0.5rem' }} />
                  <div className="wk-skeleton-block" style={{ height: '14px', width: '60px', borderRadius: '4px', marginTop: '0.25rem' }} />
                </div>
                
                <div className="wk-skeleton-block" style={{ width: '120px', height: '120px', borderRadius: '50%', margin: '0 auto' }} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <div className="wk-skeleton-block" style={{ height: '48px', width: '100px', borderRadius: '8px' }} />
                  <div className="wk-skeleton-block" style={{ height: '12px', width: '80px', borderRadius: '4px', marginTop: '0.5rem' }} />
                  <div className="wk-skeleton-block" style={{ height: '14px', width: '60px', borderRadius: '4px', marginTop: '0.25rem' }} />
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' }}>
               <div style={{ background: 'white', borderRadius: '24px', border: '1px solid #e5e7eb', padding: '2.25rem' }}>
                  <div className="wk-skeleton-block" style={{ height: '14px', width: '100px', borderRadius: '4px', marginBottom: '0.5rem' }} />
                  <div className="wk-skeleton-block" style={{ height: '28px', width: '180px', borderRadius: '6px', marginBottom: '1.5rem' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {[...Array(3)].map((_, i) => (
                       <div key={i}>
                         <div className="wk-skeleton-block" style={{ height: '14px', width: '100px', borderRadius: '4px', marginBottom: '0.25rem' }} />
                         <div className="wk-skeleton-block" style={{ height: '52px', width: '100%', borderRadius: '16px' }} />
                       </div>
                    ))}
                  </div>
               </div>
            </div>
          </div>
        </div>
      </main>
      <style>{`
        .wk-account-skeleton {
          animation: wkFadeIn 0.4s ease-out;
        }
        .wk-account-main-grid {
          grid-template-columns: 320px 1fr;
        }
        .wk-account-rewards-grid {
          grid-template-columns: 1fr auto 1fr;
        }
        .wk-skeleton-block {
          background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
          background-size: 200% 100%;
          animation: wkSkeletonShimmer 1.5s infinite linear;
        }
        @keyframes wkFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes wkSkeletonShimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @media (max-width: 1024px) {
          .wk-account-main-grid {
            grid-template-columns: 1fr !important;
          }
          .wk-account-rewards-grid {
            grid-template-columns: 1fr !important;
            text-align: center;
          }
        }
      `}</style>
    </div>
  );
}
