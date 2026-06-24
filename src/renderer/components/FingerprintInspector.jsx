/**
 * FingerprintInspector.jsx — Redesigned premium UI
 * Modal đọc fingerprint thực tế từ browser đang chạy.
 */

import React, { useState, useEffect, useCallback } from 'react';

// ─── Section component ──────────────────────────────────────────────────────

function Section({ title, icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      marginBottom: '8px',
      border: '1px solid var(--border)',
      borderRadius: '10px',
      overflow: 'hidden',
      background: 'var(--card)',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left', padding: '9px 14px',
          background: 'var(--glass)', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '8px',
          color: 'var(--fg)', fontSize: '0.76rem', fontWeight: 700,
          letterSpacing: '0.04em', textTransform: 'uppercase',
          transition: 'background 140ms',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'var(--glass)'}
      >
        <span style={{ fontSize: '1rem', lineHeight: 1 }}>{icon}</span>
        <span style={{ flex: 1 }}>{title}</span>
        <span style={{ color: 'var(--muted)', fontSize: '0.65rem', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <div style={{ padding: '6px 14px 10px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Row component ──────────────────────────────────────────────────────────

function Row({ label, value, configValue, match }) {
  const isEmpty = value === null || value === undefined || value === '';
  const showMatch = configValue !== undefined && configValue !== null && configValue !== '';
  const isMatch = showMatch ? match : null;
  const isMismatch = isMatch === false;

  const matchColor = isMatch === true ? '#10b981' : isMismatch ? '#f59e0b' : 'transparent';
  const matchBg   = isMatch === true ? 'rgba(16,185,129,0.08)' : isMismatch ? 'rgba(245,158,11,0.06)' : 'transparent';

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '130px 1fr 22px',
      alignItems: 'start', gap: '8px',
      padding: '5px 8px', margin: '2px 0',
      borderRadius: '6px',
      background: showMatch ? matchBg : 'transparent',
      border: `1px solid ${showMatch ? matchColor + '30' : 'transparent'}`,
      fontSize: '0.72rem', transition: 'background 100ms',
    }}>
      <span style={{ color: 'var(--muted)', fontWeight: 500, paddingTop: '1px', flexShrink: 0 }}>{label}</span>
      <span style={{ fontFamily: 'monospace', fontSize: '0.69rem', wordBreak: 'break-all', lineHeight: '1.5' }}>
        {/* Live value */}
        <span style={{ color: isEmpty ? 'var(--muted)' : 'var(--fg)', fontStyle: isEmpty ? 'italic' : 'normal' }}>
          {isEmpty ? '—' : (Array.isArray(value) ? value.join(', ') || '(empty)' : String(value))}
        </span>
        {/* Configured value — chỉ hiện khi mismatch để user biết expected là gì */}
        {isMismatch && (
          <span style={{ display: 'block', color: '#f59e0b', fontSize: '0.64rem', marginTop: '2px', opacity: 0.85 }}>
            Expected: {Array.isArray(configValue) ? configValue.join(', ') : String(configValue)}
          </span>
        )}
      </span>
      <span style={{ fontSize: '0.8rem', textAlign: 'center', paddingTop: '1px', lineHeight: 1 }}>
        {isMatch === true ? '✅' : isMatch === false ? '⚠️' : ''}
      </span>
    </div>
  );
}

// ─── Stat card (summary bar) ────────────────────────────────────────────────

function StatCard({ icon, label, value, color }) {
  return (
    <div style={{
      flex: 1, minWidth: 0,
      background: 'var(--glass)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '8px 12px',
      display: 'flex', flexDirection: 'column', gap: '2px',
    }}>
      <div style={{ fontSize: '0.65rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span>{icon}</span>{label}
      </div>
      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: color || 'var(--fg)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value || '—'}
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function FingerprintInspector({ profileId, profileName, configuredFp = {}, onClose }) {
  const [state, setState] = useState('idle');
  const [fp, setFp] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const res = await window.electronAPI.inspectFingerprint(profileId);
      if (res?.success) {
        setFp(res.fingerprint);
        setState('done');
      } else {
        setError(res?.error || 'Unknown error');
        setState('error');
      }
    } catch (e) {
      setError(e?.message || String(e));
      setState('error');
    }
  }, [profileId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // ── Match helpers ──────────────────────────────────────────────────────────
  // Smart UA match: so sánh platform + browser name/major version, không strict equality
  // (browser tự thêm build info vào UA thực tế → full match sẽ false negative)
  const matchUA = (() => {
    const live = fp?.identity?.userAgent;
    const cfg  = configuredFp?.userAgent;
    if (!live || !cfg) return undefined;
    const getPlatform = ua => (ua.match(/\(([^)]+)\)/) || [])[1] || '';
    const getBrowser  = ua => (ua.match(/(Chrome|Firefox|Safari|Edg|OPR)\/(\d+)/) || []).slice(1, 3).join('/');
    return getPlatform(live) === getPlatform(cfg) && getBrowser(live) === getBrowser(cfg);
  })();
  const matchLang  = fp?.identity?.language && configuredFp?.language ? fp.identity.language === configuredFp.language : undefined;
  const matchTZ    = fp?.timezone && configuredFp?.timezone ? fp.timezone === configuredFp.timezone : undefined;
  // Resolution: handle cả separator 'x' lẫn 'X'
  const _resParts  = (configuredFp?.screenResolution || '').split(/[xX×]/);
  const matchW     = fp?.screen?.width && configuredFp?.screenResolution ? fp.screen.width === Number(_resParts[0]) : undefined;
  const matchH     = fp?.screen?.height && configuredFp?.screenResolution ? fp.screen.height === Number(_resParts[1]) : undefined;
  const matchCores = fp?.identity?.hardwareConcurrency && configuredFp?.hardwareConcurrency ? fp.identity.hardwareConcurrency === Number(configuredFp.hardwareConcurrency) : undefined;
  const matchMem   = fp?.identity?.deviceMemory && configuredFp?.deviceMemory ? fp.identity.deviceMemory === Number(configuredFp.deviceMemory) : undefined;

  // Count matches for summary
  const matchList = [matchUA, matchLang, matchTZ, matchW && matchH, matchCores, matchMem].filter(m => m !== undefined);
  const matchCount  = matchList.filter(Boolean).length;
  const totalChecked = matchList.length;

  const matchPct = totalChecked > 0 ? Math.round((matchCount / totalChecked) * 100) : null;
  const matchColor = matchPct === 100 ? '#10b981' : matchPct >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <div
      id="fp-inspector-backdrop"
      onClick={(e) => { if (e.target.id === 'fp-inspector-backdrop') onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div style={{
        background: 'var(--card)',
        border: '1px solid var(--border2)',
        borderRadius: '14px',
        width: '780px', maxWidth: '96vw',
        maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--border)',
          background: 'linear-gradient(135deg, rgba(0,210,211,0.06) 0%, transparent 60%)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '10px',
              background: 'linear-gradient(135deg, rgba(0,210,211,0.2), rgba(30,177,217,0.1))',
              border: '1px solid rgba(0,210,211,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.1rem',
            }}>🔍</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Fingerprint Inspector
                {state === 'done' && matchPct !== null && (
                  <span style={{
                    fontSize: '0.67rem', fontWeight: 700, padding: '2px 8px',
                    borderRadius: '999px', background: matchColor + '20',
                    color: matchColor, border: `1px solid ${matchColor}40`,
                    letterSpacing: '0.03em',
                  }}>
                    {matchCount}/{totalChecked} match
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>Profile:</span>
                <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{profileName || profileId}</span>
                {fp?.capturedAt && (
                  <span style={{ color: 'var(--muted)' }}>
                    · {new Date(fp.capturedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              id="btn-fp-inspector-refresh"
              onClick={load}
              disabled={state === 'loading'}
              className="btn"
              style={{ fontSize: '0.72rem', gap: '5px', opacity: state === 'loading' ? 0.6 : 1 }}
            >
              <span style={{ display: 'inline-block', animation: state === 'loading' ? 'spin 1s linear infinite' : 'none' }}>↻</span>
              {state === 'loading' ? 'Reading...' : 'Refresh'}
            </button>
            <button
              id="btn-fp-inspector-close"
              onClick={onClose}
              className="btn"
              style={{ fontSize: '0.72rem', color: 'var(--muted)' }}
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* ── Legend bar ── */}
        {state === 'done' && (
          <div style={{
            padding: '6px 18px',
            background: 'var(--glass)',
            borderBottom: '1px solid var(--border)',
            display: 'flex', gap: '16px', alignItems: 'center',
            fontSize: '0.65rem', color: 'var(--muted)', flexShrink: 0,
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>✅ <span>Matches config</span></span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>⚠️ <span>Mismatch</span></span>
            <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>Values read live from browser via page.evaluate()</span>
          </div>
        )}

        {/* ── Summary stats ── */}
        {state === 'done' && fp && (
          <div style={{
            padding: '10px 18px',
            borderBottom: '1px solid var(--border)',
            display: 'flex', gap: '8px', flexShrink: 0,
            background: 'var(--card2)',
          }}>
            <StatCard icon="🖥" label="Resolution" value={fp.screen ? `${fp.screen.width}×${fp.screen.height}` : null} />
            <StatCard icon="🌍" label="Timezone" value={fp.timezone} color="var(--primary)" />
            <StatCard icon="🗣" label="Language" value={fp.identity?.language} />
            <StatCard icon="⚙" label="CPU Cores" value={fp.identity?.hardwareConcurrency} />
            <StatCard icon="💾" label="Memory" value={fp.identity?.deviceMemory ? `${fp.identity.deviceMemory} GB` : null} />
            <StatCard icon="🕵️" label="Webdriver" value={fp.identity?.webdriver === false ? 'Hidden ✅' : 'Exposed ⚠️'} color={fp.identity?.webdriver === false ? '#10b981' : '#f59e0b'} />
          </div>
        )}

        {/* ── Content ── */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 18px' }}>

          {/* Loading */}
          {state === 'loading' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', gap: '14px' }}>
              <div style={{ position: 'relative', width: '48px', height: '48px' }}>
                <div style={{
                  width: '48px', height: '48px', borderRadius: '50%',
                  border: '3px solid var(--border2)',
                  borderTopColor: 'var(--primary)',
                  animation: 'spin 0.8s linear infinite',
                }} />
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--fg)', fontWeight: 600 }}>Reading fingerprint...</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Connecting to live browser context</div>
            </div>
          )}

          {/* Error */}
          {state === 'error' && (
            <div style={{
              padding: '24px', borderRadius: '10px', textAlign: 'center',
              background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)',
            }}>
              <div style={{ fontSize: '2rem', marginBottom: '10px' }}>❌</div>
              <div style={{ fontSize: '0.88rem', color: '#ef4444', fontWeight: 700, marginBottom: '6px' }}>Failed to read fingerprint</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--muted)', fontFamily: 'monospace', marginBottom: '12px' }}>{error}</div>
              {error.includes('not running') && (
                <div style={{ fontSize: '0.75rem', color: '#f59e0b', padding: '8px 12px', background: 'rgba(245,158,11,0.08)', borderRadius: '6px', display: 'inline-block' }}>
                  ⚠️ Please launch the profile first, then click Refresh.
                </div>
              )}
            </div>
          )}

          {/* Done */}
          {state === 'done' && fp && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>

              {/* Identity */}
              <Section title="Identity" icon="🪪">
                <Row label="User Agent"     value={fp.identity?.userAgent}           configValue={configuredFp?.userAgent}      match={matchUA} />
                <Row label="Platform"       value={fp.identity?.platform}            configValue={configuredFp?.platform} />
                <Row label="Language"       value={fp.identity?.language}            configValue={configuredFp?.language}       match={matchLang} />
                <Row label="Languages"      value={fp.identity?.languages} />
                <Row label="Vendor"         value={fp.identity?.vendor} />
                <Row label="Webdriver"      value={String(fp.identity?.webdriver)}   configValue="false"                        match={fp.identity?.webdriver === false || fp.identity?.webdriver === null} />
                <Row label="Plugins count"  value={fp.identity?.plugins?.length} />
              </Section>

              {/* Hardware */}
              <Section title="Hardware" icon="🖥️">
                <Row label="CPU Cores"      value={fp.identity?.hardwareConcurrency} configValue={configuredFp?.hardwareConcurrency} match={matchCores} />
                <Row label="Device Memory"  value={fp.identity?.deviceMemory != null ? `${fp.identity.deviceMemory} GB` : null} configValue={configuredFp?.deviceMemory ? `${configuredFp.deviceMemory} GB` : null} match={matchMem} />
                <Row label="Timezone"       value={fp.timezone}                      configValue={configuredFp?.timezone}           match={matchTZ} />
                <Row label="Locale"         value={fp.locale} />
              </Section>

              {/* Screen */}
              <Section title="Screen" icon="🖥">
                <Row label="Resolution"      value={fp.screen ? `${fp.screen.width}×${fp.screen.height}` : null}           configValue={configuredFp?.screenResolution} match={matchW && matchH} />
                <Row label="Avail size"      value={fp.screen ? `${fp.screen.availWidth}×${fp.screen.availHeight}` : null} />
                <Row label="Color depth"     value={fp.screen?.colorDepth}     configValue={configuredFp?.colorDepth} />
                <Row label="Pixel depth"     value={fp.screen?.pixelDepth} />
                <Row label="Device px ratio" value={fp.screen?.devicePixelRatio} configValue={configuredFp?.pixelRatio} />
                <Row label="Inner size"      value={fp.screen ? `${fp.screen.innerWidth}×${fp.screen.innerHeight}` : null} />
              </Section>

              {/* Canvas */}
              <Section title="Canvas Fingerprint" icon="🎨">
                <Row label="Canvas hash" value={fp.canvas?.hash} />
                <div style={{
                  fontSize: '0.67rem', color: 'var(--muted)', marginTop: '8px',
                  padding: '7px 10px', background: 'var(--glass)', borderRadius: '6px',
                  border: '1px solid var(--border)', lineHeight: 1.5,
                }}>
                  💡 Hash thay đổi mỗi lần reload = noise injection hoạt động. Hash giống nhau = không có noise.
                </div>
              </Section>

              {/* WebGL */}
              <Section title="WebGL" icon="🔷">
                <Row label="Renderer"          value={fp.webgl?.renderer}      configValue={configuredFp?.webglRenderer} match={fp.webgl?.renderer && configuredFp?.webglRenderer ? fp.webgl.renderer === configuredFp.webglRenderer : undefined} />
                <Row label="Vendor"            value={fp.webgl?.vendor}        configValue={configuredFp?.webglVendor}   match={fp.webgl?.vendor && configuredFp?.webglVendor ? fp.webgl.vendor === configuredFp.webglVendor : undefined} />
                <Row label="GL Version"        value={fp.webgl?.version} />
                <Row label="GLSL Version"      value={fp.webgl?.shadingVersion} />
                <Row label="Extensions (×10)"  value={fp.webgl?.extensions} />
              </Section>

              {/* Audio */}
              <Section title="Audio" icon="🔊">
                <Row label="Sample Rate"    value={fp.audio?.sampleRate}      configValue={configuredFp?.audioSampleRate} />
                <Row label="Max Channels"   value={fp.audio?.maxChannelCount} configValue={configuredFp?.audioChannels} />
                <Row label="Context state"  value={fp.audio?.state} />
              </Section>

              {/* Battery */}
              <Section title="Battery" icon="🔋" defaultOpen={false}>
                {fp.battery ? (
                  <>
                    <Row label="Charging"        value={String(fp.battery.charging)} configValue={configuredFp?.batteryCharging} match={String(fp.battery.charging) === (configuredFp?.batteryCharging === 'Yes' ? 'true' : 'false')} />
                    <Row label="Level"           value={`${Math.round((fp.battery.level || 0) * 100)}%`} configValue={configuredFp?.batteryLevel != null ? `${Math.round(Number(configuredFp.batteryLevel) * 100)}%` : null} match={configuredFp?.batteryLevel != null ? Math.round((fp.battery.level || 0) * 100) === Math.round(Number(configuredFp.batteryLevel) * 100) : undefined} />
                    <Row label="Charging time"   value={fp.battery.chargingTime === Infinity ? '∞' : fp.battery.chargingTime} />
                    <Row label="Discharging time" value={fp.battery.dischargingTime === Infinity ? '∞' : fp.battery.dischargingTime} />
                  </>
                ) : (
                  <div style={{ fontSize: '0.72rem', color: 'var(--muted)', fontStyle: 'italic', padding: '4px 0' }}>Battery API not available in this browser</div>
                )}
              </Section>

              {/* Network */}
              <Section title="Network" icon="🌐" defaultOpen={false}>
                {fp.network ? (
                  <>
                    <Row label="Effective type" value={fp.network.effectiveType} configValue={configuredFp?.connectionType} />
                    <Row label="Downlink (Mbps)" value={fp.network.downlink} />
                    <Row label="RTT (ms)"        value={fp.network.rtt} />
                    <Row label="Save data"       value={String(fp.network.saveData)} />
                  </>
                ) : (
                  <div style={{ fontSize: '0.72rem', color: 'var(--muted)', fontStyle: 'italic', padding: '4px 0' }}>Network Information API not available</div>
                )}
              </Section>

              {/* Fonts */}
              <Section title="Detected Fonts" icon="🔤" defaultOpen={false}>
                {fp.fonts?.length ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', paddingTop: '2px' }}>
                    {fp.fonts.map(f => (
                      <span key={f} style={{
                        fontSize: '0.67rem', padding: '2px 8px', borderRadius: '999px',
                        background: 'var(--glass)', border: '1px solid var(--border)',
                        color: 'var(--fg)', fontFamily: 'monospace',
                      }}>{f}</span>
                    ))}
                  </div>
                ) : (
                  <span style={{ color: 'var(--muted)', fontStyle: 'italic', fontSize: '0.72rem' }}>None detected</span>
                )}
              </Section>

            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {state === 'done' && fp && (
          <div style={{
            padding: '8px 18px',
            borderTop: '1px solid var(--border)',
            background: 'var(--glass)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            flexShrink: 0,
            fontSize: '0.67rem', color: 'var(--muted)',
          }}>
            <span>Captured at {new Date(fp.capturedAt).toLocaleString()}</span>
            {matchPct !== null && (
              <span style={{ fontWeight: 600, color: matchColor }}>
                {matchCount}/{totalChecked} configured values match · {matchPct}%
              </span>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
