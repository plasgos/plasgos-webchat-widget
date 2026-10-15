/**
 * Gaya aplikasi widget. Dokumen iframe api-crm mengizinkan `style-src … 'unsafe-inline'` (gaya hanya memengaruhi
 * iframe ini, tak pernah website tenant), jadi satu `<style>` disuntik sekali. Warna tenant lewat variabel CSS.
 */
export const STYLES = `
:root{--pw-primary:#f0592b;--pw-on-primary:#fff;--pw-bg:#fff;--pw-surface:#f7f5f3;--pw-text:#1f2024;--pw-muted:#6b6a72;
--pw-border:#e9e4df;--pw-in:#f1efed;--pw-danger:#b42318;--pw-radius:16px;color-scheme:light}
:root[data-theme="dark"]{--pw-bg:#1d1b19;--pw-surface:#26231f;--pw-text:#f3efea;--pw-muted:#b3aca4;--pw-border:#3a342e;
--pw-in:#2f2a25;--pw-danger:#ff9b8f;color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:transparent;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
color:var(--pw-text);-webkit-font-smoothing:antialiased}
button,textarea{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--pw-primary);outline-offset:2px}
.pw-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.pw-launcher{position:absolute;bottom:12px;width:56px;height:56px;border:0;border-radius:50%;background:var(--pw-primary);
color:var(--pw-on-primary);cursor:pointer;display:grid;place-items:center;box-shadow:0 8px 24px -6px rgba(0,0,0,.35);
transition:transform .15s}
.pw-root[data-position="right"] .pw-launcher{right:12px}.pw-root[data-position="left"] .pw-launcher{left:12px}
.pw-launcher:hover{transform:scale(1.05)}
.pw-badge{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;
background:var(--pw-danger);color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center}
.pw-window{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--pw-bg);border:1px solid var(--pw-border);
border-radius:var(--pw-radius);overflow:hidden;box-shadow:0 20px 60px -24px rgba(0,0,0,.45)}
.pw-root[data-fullscreen="true"] .pw-window{border-radius:0;border:0;padding:env(safe-area-inset-top) env(safe-area-inset-right)
env(safe-area-inset-bottom) env(safe-area-inset-left)}
.pw-window[hidden],.pw-launcher[hidden]{display:none}
.pw-header{display:flex;align-items:center;gap:10px;padding:14px 14px 14px 16px;background:var(--pw-primary);color:var(--pw-on-primary)}
.pw-header h2{margin:0;font-size:15px;line-height:1.3}
.pw-header p{margin:2px 0 0;font-size:12px;opacity:.9}
.pw-header .pw-head-text{flex:1;min-width:0}
.pw-logo{width:32px;height:32px;border-radius:50%;object-fit:cover;background:rgba(255,255,255,.2)}
.pw-icon-btn{width:34px;height:34px;border:0;border-radius:10px;background:transparent;color:inherit;cursor:pointer;
display:grid;place-items:center}
.pw-icon-btn:hover{background:rgba(255,255,255,.18)}
.pw-notice{padding:9px 14px;font-size:12.5px;background:var(--pw-surface);border-bottom:1px solid var(--pw-border)}
.pw-notice[data-tone="error"]{color:var(--pw-danger)}
.pw-messages{flex:1;margin:0;padding:14px;list-style:none;overflow-y:auto;display:flex;flex-direction:column;gap:8px;
background:var(--pw-surface);overscroll-behavior:contain}
.pw-msg{max-width:84%;display:flex;flex-direction:column}
.pw-msg[data-side="visitor"]{align-self:flex-end;align-items:flex-end}
.pw-msg[data-side="team"]{align-self:flex-start;align-items:flex-start}
.pw-bubble{padding:8px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}
.pw-msg[data-side="visitor"] .pw-bubble{background:var(--pw-primary);color:var(--pw-on-primary);border-bottom-right-radius:4px}
.pw-msg[data-side="team"] .pw-bubble{background:var(--pw-in);border-bottom-left-radius:4px}
.pw-bubble a{color:inherit;text-decoration:underline}
.pw-bubble code{font-family:ui-monospace,monospace;font-size:12.5px;background:rgba(0,0,0,.08);padding:0 4px;border-radius:4px}
.pw-meta{margin-top:3px;font-size:11px;color:var(--pw-muted);display:flex;gap:6px;align-items:center}
.pw-retry{border:0;background:none;padding:0;color:var(--pw-danger);text-decoration:underline;cursor:pointer;font-size:11px}
.pw-typing{min-height:20px;padding:0 16px 4px;font-size:12px;color:var(--pw-muted);background:var(--pw-surface)}
.pw-captcha{padding:12px;display:flex;justify-content:center;background:var(--pw-surface)}
.pw-composer{display:flex;gap:8px;align-items:flex-end;padding:10px;border-top:1px solid var(--pw-border);background:var(--pw-bg)}
.pw-composer textarea{flex:1;resize:none;max-height:120px;min-height:40px;padding:9px 12px;border:1px solid var(--pw-border);
border-radius:12px;background:var(--pw-bg);line-height:1.4}
.pw-composer textarea:focus{outline:none;border-color:var(--pw-primary)}
.pw-send{width:40px;height:40px;border:0;border-radius:12px;background:var(--pw-primary);color:var(--pw-on-primary);cursor:pointer;
display:grid;place-items:center}
.pw-send:disabled{opacity:.5;cursor:not-allowed}
.pw-attach{width:40px;height:40px;border:0;border-radius:12px;background:transparent;color:var(--pw-muted,inherit);cursor:pointer;display:flex;align-items:center;justify-content:center}
.pw-attach[hidden],.pw-file-input{display:none}
.pw-attach:disabled{opacity:.5;cursor:not-allowed}
.pw-attachment-image{display:block;margin:-4px -6px 6px}
.pw-attachment-img{display:block;max-width:220px;max-height:220px;border-radius:10px;object-fit:cover}
.pw-attachment-file{display:flex;gap:8px;align-items:center;margin-bottom:4px;color:inherit;text-decoration:none}
.pw-attachment-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px}
.pw-attachment-size{opacity:.7;font-size:12px}
.pw-prechat{padding:14px 16px;border-top:1px solid var(--pw-border);background:var(--pw-bg);display:flex;flex-direction:column;
gap:10px;max-height:60%;overflow-y:auto}
.pw-prechat[hidden]{display:none}
.pw-prechat-title{margin:0;font-weight:600}
.pw-prechat-fields{display:flex;flex-direction:column;gap:10px}
.pw-field{display:flex;flex-direction:column;gap:4px}
.pw-field-label{font-size:12.5px;color:var(--pw-muted)}
.pw-field-input{padding:9px 12px;border:1px solid var(--pw-border);border-radius:10px;background:var(--pw-bg);font:inherit;
color:inherit}
.pw-field-input:focus{outline:none;border-color:var(--pw-primary)}
.pw-field-input[aria-invalid="true"]{border-color:var(--pw-danger)}
.pw-field-consent{flex-direction:row;flex-wrap:wrap;align-items:flex-start;gap:8px}
.pw-field-consent .pw-field-label{flex:1;color:var(--pw-text)}
.pw-field-consent .pw-field-error{flex-basis:100%}
.pw-field-error,.pw-prechat-failure{margin:0;font-size:12px;color:var(--pw-danger)}
.pw-prechat-actions{display:flex;justify-content:flex-end;gap:8px}
.pw-prechat-submit,.pw-prechat-skip{padding:9px 16px;border-radius:10px;cursor:pointer;font:inherit;font-weight:600}
.pw-prechat-submit{border:0;background:var(--pw-primary);color:var(--pw-on-primary)}
.pw-prechat-submit:disabled{opacity:.6;cursor:progress}
.pw-prechat-skip{border:1px solid var(--pw-border);background:transparent;color:inherit}
.pw-otp-entry{margin:0;padding:8px 14px;border:0;border-bottom:1px solid var(--pw-border);background:var(--pw-surface);
color:var(--pw-primary);font:inherit;font-weight:600;text-align:left;cursor:pointer;text-decoration:underline}
.pw-otp-entry[hidden],.pw-otp[hidden]{display:none}
.pw-handoff{border-bottom:0;border-top:1px solid var(--pw-border)}
.pw-handoff:disabled{opacity:.6;cursor:progress}
.pw-otp{padding:14px 16px;border-top:1px solid var(--pw-border);background:var(--pw-bg);display:flex;flex-direction:column;gap:8px}
.pw-otp-title{margin:0;font-weight:600}
.pw-otp-hint{margin:0;font-size:12.5px;color:var(--pw-muted)}
.pw-team-status{margin:2px 0 0;font-size:12px;display:flex;align-items:center;gap:6px}
.pw-team-status[hidden]{display:none}
.pw-team-status::before{content:"";width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.55)}
.pw-team-status[data-online="true"]::before{background:#22c55e;box-shadow:0 0 0 2px rgba(255,255,255,.6)}
.pw-survey{margin-top:6px;padding:10px 12px;border:1px solid var(--pw-border);border-radius:12px;background:var(--pw-bg);
display:flex;flex-direction:column;gap:8px;max-width:100%}
.pw-survey-scale{display:flex;gap:4px}
.pw-survey-option{width:36px;height:36px;border:1px solid var(--pw-border);border-radius:10px;background:transparent;cursor:pointer;
font-size:18px;line-height:1;color:var(--pw-muted)}
.pw-survey-option[data-selected="true"]{color:#f5a524;border-color:#f5a524;background:rgba(245,165,36,.12)}
.pw-survey-option:not(:disabled):hover{border-color:var(--pw-primary);color:var(--pw-primary)}
.pw-survey-option:disabled{cursor:default}
.pw-survey-status,.pw-survey-comment-sent{margin:0;font-size:12.5px;color:var(--pw-muted)}
.pw-survey-status[hidden]{display:none}
.pw-survey-comment{display:flex;flex-direction:column;gap:6px}
.pw-transcript[hidden],.pw-field[hidden]{display:none}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
`;
