/**
 * Scoped styles for the Navoro shadow root. Nothing here leaks into the host page.
 * Palette follows web/src/styles/tokens.css: ink surfaces, warm-white panel,
 * lime reserved for focus and progress.
 */

/**
 * Clicky Lite's buddy: an original mark (not Clicky's real buddy). A round blue body
 * with two eyes; the pointer nub is drawn in CSS so it can turn toward the target.
 */
export const BUDDY_SVG =
  '<svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true" focusable="false">' +
  '<circle cx="22" cy="22" r="19" fill="var(--blue,#2F6FEA)"/>' +
  '<circle cx="22" cy="22" r="19" fill="none" stroke="#fff" stroke-width="2.5"/>' +
  '<ellipse class="eye" cx="16.5" cy="20" rx="2.6" ry="3.6" fill="#fff"/>' +
  '<ellipse class="eye" cx="27.5" cy="20" rx="2.6" ry="3.6" fill="#fff"/>' +
  '<path d="M17 28.2q5 3.6 10 0" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>';

/** Small buddy face for the launcher and panel header. */
export function markSvg(size: number, withTile = false): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">` +
    (withTile ? '<rect width="32" height="32" rx="10" fill="#EAEEFF"/>' : '') +
    '<circle cx="16" cy="16" r="11" fill="#2F6FEA"/>' +
    '<path d="M16 2.6l3.2 4.6h-6.4z" fill="#2F6FEA"/>' +
    '<ellipse cx="12.6" cy="14.8" rx="1.7" ry="2.3" fill="#fff"/><ellipse cx="19.4" cy="14.8" rx="1.7" ry="2.3" fill="#fff"/>' +
    '<path d="M12.8 19.8q3.2 2.3 6.4 0" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>'
  );
}

export const STYLES = `
:host{all:initial}
*,*::before,*::after{box-sizing:border-box}
.root{--ink:#161B36;--ink2:#2A3052;--paper:#FFFFFF;--line:#E1E5F2;--line2:#C3CAE2;--muted:#4A5173;--subtle:#5F6788;--lime:#2F6FEA;--blue:#2F6FEA;--on-accent:#fff;--sunk:#EEF1FC;--amber:#8A4B00;--amber-bg:#FFF3D6;--sh:0 1px 2px rgba(22,27,54,.08),0 16px 40px rgba(22,27,54,.18);
font:14.5px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Inter","Helvetica Neue",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
button,input{font:inherit;color:inherit;margin:0}
button{cursor:pointer;border:0;background:none;padding:0}
button:disabled{cursor:default;opacity:.45}
:focus{outline:none}
:focus-visible{box-shadow:0 0 0 2px var(--paper),0 0 0 4.5px var(--blue)}
[hidden]{display:none!important}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.root{--edge:20px}
.launcher,.panel,.card.docked{position:fixed;right:20px;pointer-events:auto}
.left .launcher,.left .panel,.left .card.docked{right:auto;left:20px}
.top .panel,.top .card.docked{bottom:auto;top:var(--edge)}
.top .panel{max-height:min(70vh,640px)}
.launcher{bottom:20px;width:56px;height:56px;border-radius:50%;background:#fff;border:1px solid var(--line);display:grid;place-items:center;box-shadow:var(--sh);transition:transform .16s}
.launcher:hover{transform:translateY(-1px)}
.panel{bottom:84px;width:372px;max-height:min(72vh,660px);display:flex;flex-direction:column;background:var(--paper);border:1px solid var(--line);border-radius:20px;box-shadow:var(--sh);overflow:hidden}
.panel,.card{animation:rise .18s ease-out}
@keyframes rise{from{opacity:0;transform:translateY(6px)}}
.head{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 14px;border-bottom:1px solid var(--line);cursor:grab;touch-action:none;user-select:none}
.panel.placed{animation:none}.panel.moving{animation:none;box-shadow:0 2px 4px rgba(17,18,16,.1),0 22px 48px rgba(17,18,16,.24)}.panel.moving .head{cursor:grabbing}
.home-ghost{position:fixed;pointer-events:none;border:2px dashed var(--line2);border-radius:14px;opacity:0;transition:opacity .15s,border-color .15s,background .15s}.home-ghost.show{opacity:1}.home-ghost.hot{border-color:var(--lime);background:color-mix(in srgb,var(--lime) 16%,transparent)}
.name{flex:1;min-width:0}
h2{margin:0;font:700 15px/1.2 "Bricolage Grotesque","Atkinson Hyperlegible",system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.by{font-size:12px;color:var(--subtle)}
.icon-btn{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:var(--muted)}
.icon-btn:hover,.ghost:hover:not(:disabled){background:var(--sunk);color:var(--ink)}
.body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px;overscroll-behavior:contain}
.greet,.answer,.card p{margin:0;color:var(--ink2);white-space:pre-wrap;overflow-wrap:anywhere}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip,.secondary,.form input{border:1px solid var(--line2);background:#fff}
.chip{border-radius:999px;padding:6px 12px;font-size:13.5px;text-align:left;background:var(--sunk);border-color:transparent;color:var(--ink)}
.chip:hover{background:#E1E7FF;border-color:var(--blue)!important}
.chip:hover,.secondary:hover:not(:disabled),.form input:focus-visible{border-color:var(--ink)}
.form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line);background:#fff}
.mic{flex:none;width:36px;height:36px;border-radius:10px;display:grid;place-items:center;color:var(--muted);border:1px solid var(--line2);background:#fff}
.mic:hover{color:var(--ink);border-color:var(--ink)}
.mic[aria-pressed="true"]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.mic[aria-pressed="true"] svg{animation:listen 1.2s ease-in-out infinite}
@keyframes listen{50%{opacity:.45}}
@media (prefers-reduced-motion:reduce){.mic[aria-pressed="true"] svg{animation:none}}
.resume{font-size:12px;color:var(--muted);background:var(--sunk);border-radius:6px;padding:4px 8px;align-self:flex-start}
.local{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px}
.local::before{content:"";width:7px;height:7px;border-radius:50%;background:#1E9E62}
.handoff{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--line2);border-radius:10px;background:#fff}
.sheet{display:flex;flex-direction:column;gap:10px}.sheet h3{margin:0;font-size:16px;font-weight:650}.sheet p{margin:0;color:var(--ink2);font-size:13.5px}.sheet .small{font-size:12.5px;color:var(--muted)}
.sheet label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted)}.sheet textarea{font:inherit;font-size:13.5px;color:var(--ink);border:1px solid var(--line2);border-radius:10px;padding:8px 10px;resize:vertical;background:#fff}
.passes{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:12px;background:var(--sunk)}.passes b{font-size:12.5px;font-weight:600}.passes .row{font-size:13px;color:var(--ink2);padding-left:16px;position:relative}.passes .row::before{content:"";position:absolute;left:3px;top:.55em;width:6px;height:6px;border-radius:50%;background:var(--blue)}
.row-btns{display:flex;flex-wrap:wrap;gap:8px}.sheet .actions{display:flex;gap:8px;flex-wrap:wrap}
.stuckbar{display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;padding:0 10px 10px;margin-top:-2px;background:#fff;font-size:12.5px;color:var(--muted)}.stuckbar .link{font-size:12.5px;color:var(--blue)}
.nav .stuck{margin-right:auto;font-size:12.5px;color:var(--muted);text-decoration:underline;text-underline-offset:2px}
.handoff p{margin:0;font-size:13px;color:var(--ink2)}
.form input{flex:1;min-width:0;border-radius:10px;padding:8px 11px}
.form input::placeholder{color:var(--subtle)}
.btn{display:inline-flex;align-items:center;gap:6px;border-radius:10px;padding:7px 13px;font-weight:550;font-size:13.5px;white-space:nowrap}
.primary{background:var(--blue);color:#fff}
.primary:hover:not(:disabled){background:#2C46E0}
.ghost{color:var(--muted);padding:6px 8px}
.q{align-self:flex-end;max-width:85%;background:var(--blue);color:#fff;border-radius:12px 12px 4px 12px;padding:7px 11px;overflow-wrap:anywhere}
.loading,.fb,.top,.done{display:flex;align-items:center;gap:10px;color:var(--muted)}
.grow,.count{flex:1}
.dots{display:inline-flex;gap:3px}
.dots i{width:5px;height:5px;border-radius:50%;background:var(--ink);opacity:.25;animation:blink 1.1s infinite}
.dots i+i{animation-delay:.15s}.dots i+i+i{animation-delay:.3s}
@keyframes blink{40%{opacity:.85}}
.badge{align-self:flex-start;font-size:11.5px;font-weight:550;padding:3px 8px;border-radius:6px;background:#E9EFFC;color:#2453C7}
.note,.miss,.err{font-size:13px;padding:8px 10px;border-radius:8px;background:var(--amber-bg);color:var(--amber)}
.err{background:#FBEAEA;color:#B42318;display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.done{padding:10px;border-radius:10px;background:#fff;border:1px solid var(--line);font-size:13px}
.done strong{display:block;font-size:14px;font-weight:600;color:var(--ink)}
.tick{width:24px;height:24px;border-radius:50%;background:var(--lime);color:var(--on-accent,#111210);display:grid;place-items:center;flex:none}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.cites{border-top:1px solid var(--line);padding-top:10px}
summary{cursor:pointer;font-size:12.5px;color:var(--muted);border-radius:6px}
.cite{margin:8px 0 0;padding-left:10px;border-left:2px solid var(--line2);font-size:12.5px}
.cite b{display:block}
.cite p{margin:2px 0 0;color:var(--muted)}
.mail{font-size:13px;color:var(--muted)}.mail .addr{user-select:all}
.link{font-weight:550;text-decoration:underline;text-underline-offset:2px;border-radius:4px;align-self:flex-start;color:inherit}
.fb{gap:4px;font-size:12.5px}
.inspect pre{margin:6px 0 0;max-height:220px;overflow:auto;font:11.5px/1.4 ui-monospace,Menlo,monospace;background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px;white-space:pre-wrap;overflow-wrap:anywhere}
.layer{position:fixed;inset:0;pointer-events:none}
.ring{position:fixed;pointer-events:none}
.ring{border-radius:10px;box-shadow:0 0 0 2px #fff,0 0 0 5px var(--blue),0 0 0 9999px rgba(22,27,54,.16);transition:all .25s cubic-bezier(.3,1.3,.5,1)}
.pulse::after{content:"";position:absolute;inset:-5px;border-radius:11px;border:2px solid var(--lime);animation:pulse 1.1s ease-out 2}
@keyframes pulse{to{opacity:0;transform:scale(1.18)}}
.found{position:absolute;bottom:calc(100% + 8px);left:0;background:var(--blue);color:#fff;font-size:12px;font-weight:600;padding:3px 8px;border-radius:6px;animation:fade 1.6s forwards}
@keyframes fade{70%{opacity:1}to{opacity:0}}
.card{position:fixed;width:300px;max-width:calc(100vw - 16px);background:var(--paper);border:2px solid var(--blue);border-radius:20px;box-shadow:var(--sh);padding:12px 16px 14px;transition:top .45s cubic-bezier(.3,1.25,.5,1),left .45s cubic-bezier(.3,1.25,.5,1);pointer-events:auto;display:flex;flex-direction:column;gap:6px}
.card.docked{bottom:84px}
.count{font-size:12px;font-weight:550;font-variant-numeric:tabular-nums}
.bar{height:3px;border-radius:2px;background:var(--line);overflow:hidden}
.bar i{display:block;height:100%;background:var(--lime)}
h3{margin:2px 0 0;font:700 16px/1.25 "Bricolage Grotesque","Atkinson Hyperlegible",system-ui,sans-serif}
.nav{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px}
@media (max-width:480px){.head{cursor:default}.panel,.left .panel{left:0;right:0;bottom:0;width:100%;max-height:80vh;border-radius:16px 16px 0 0}.top .panel,.top.left .panel{left:8px;right:8px;bottom:auto;top:var(--edge);width:auto;max-height:calc(100vh - var(--edge) - 8px);border-radius:14px}.card.docked,.left .card.docked{left:8px;right:8px;width:auto}}
.buddy{position:fixed;top:0;left:0;width:44px;height:44px;pointer-events:none;transition:transform .6s cubic-bezier(.34,1.4,.5,1),opacity .3s;filter:drop-shadow(0 6px 10px rgba(22,27,54,.28));z-index:2}
.buddy::before{content:"";position:absolute;inset:-11px;background:var(--blue);clip-path:polygon(50% 0,63% 27%,37% 27%);transform:rotate(var(--nub,0deg));transition:transform .4s}
.buddy>span>svg,.buddy svg{position:relative;display:block;animation:bob 2.4s ease-in-out infinite}
.buddy .eye{animation:blink2 4.2s infinite;transform-origin:center;transform-box:fill-box}
@keyframes bob{50%{transform:translateY(-3px)}}
@keyframes blink2{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
.buddy.home{opacity:0;transform:translate(calc(100vw - 64px),calc(100vh - 64px)) scale(.5)!important}
.card[data-side]::after{content:"";position:absolute;width:14px;height:14px;background:var(--paper);border:2px solid var(--blue);border-right:0;border-bottom:0;left:calc(50% - 7px)}
.card[data-side=below]::after{top:-9px;transform:rotate(45deg)}
.card[data-side=above]::after{bottom:-9px;transform:rotate(225deg)}
.card[data-side=right]::after{left:-9px;top:calc(50% - 7px);transform:rotate(-45deg)}
.card[data-side=left]::after{left:auto;right:-9px;top:calc(50% - 7px);transform:rotate(135deg)}
.card.docked::after{display:none}
.card .count{color:var(--blue);font-weight:700}
/* heyclicky-style skin: mac window panel, glossy pills, lowercase */
h2,h3,.chip,.btn,.count,.by,.badge,summary,.done strong{text-transform:lowercase}
h2,h3{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Inter",system-ui,sans-serif;letter-spacing:-.01em}
.panel{border-radius:12px;border:1px solid rgba(0,0,0,.16);box-shadow:inset 0 1px 0 #fff,0 22px 50px -18px rgba(20,24,40,.45),0 3px 8px rgba(20,24,40,.1)}
.head{background:linear-gradient(#F5F5F6,#E5E5E8);border-bottom:1px solid rgba(0,0,0,.1);padding:9px 10px 9px 74px;position:relative}
.head::before{content:"";position:absolute;left:13px;top:50%;width:52px;height:12px;margin-top:-6px;background:radial-gradient(circle at 6px 6px,#FF5F57 5.5px,transparent 6px),radial-gradient(circle at 26px 6px,#FEBC2E 5.5px,transparent 6px),radial-gradient(circle at 46px 6px,#28C840 5.5px,transparent 6px)}
.head h2{font-size:14px;font-weight:600}
.by{font-size:11.5px}
.body{background:linear-gradient(180deg,#fff 70%,#F4F8FF)}
.chip{background:linear-gradient(180deg,#fff,#F1F1F3 50%,#E8E8EC 52%,#F4F4F6);border:1px solid #C3C5CC!important;box-shadow:inset 0 1px 0 #fff,0 1px 2px rgba(0,0,0,.06);color:var(--ink)}
.chip:hover{background:linear-gradient(180deg,#fff,#EAF1FF);border-color:#7DA5F2!important}
.primary{border-radius:999px;padding:7px 16px;color:#fff;background:linear-gradient(180deg,#8DB6FF 0%,#4D86F2 45%,#2C66E4 55%,#3E7BF0 100%);border:1px solid #1F4FC4;box-shadow:inset 0 1px 0 rgba(255,255,255,.65),0 3px 8px -3px rgba(31,79,196,.55);text-shadow:0 1px 1px rgba(10,40,120,.3)}
.primary:hover:not(:disabled){background:linear-gradient(180deg,#9CC0FF 0%,#5A90F5 45%,#3470EA 55%,#4A84F2 100%)}
.ghost{border-radius:999px}
.q{border-radius:16px 16px 4px 16px;background:linear-gradient(180deg,#5D93F5,#2C66E4)}
.form{background:#F6F6F8}
.form input{border-radius:999px;padding:8px 14px;border-color:#C9CBD2}
.mic{border-radius:50%}
.launcher{background:linear-gradient(180deg,#8DB6FF,#2C66E4);border:1px solid #1F4FC4;box-shadow:inset 0 1px 0 rgba(255,255,255,.6),0 10px 24px -8px rgba(31,79,196,.6)}
.card{border:1px solid rgba(0,0,0,.14);border-radius:14px;padding:0 0 12px;gap:0;overflow:visible;box-shadow:0 18px 40px -16px rgba(20,24,40,.45),0 2px 6px rgba(20,24,40,.08)}
.card .top{background:linear-gradient(#F5F5F6,#E5E5E8);border-bottom:1px solid rgba(0,0,0,.1);border-radius:13px 13px 0 0;padding:6px 8px 6px 62px;position:relative;min-height:28px}
.card .top::before{content:"";position:absolute;left:11px;top:50%;width:44px;height:10px;margin-top:-5px;background:radial-gradient(circle at 5px 5px,#FF5F57 4.5px,transparent 5px),radial-gradient(circle at 22px 5px,#FEBC2E 4.5px,transparent 5px),radial-gradient(circle at 39px 5px,#28C840 4.5px,transparent 5px)}
.card>:not(.top){margin-left:14px;margin-right:14px}
.card .bar{margin-top:10px}
.card h3{margin-top:8px}
.card p{margin-top:4px}
.card[data-side]::after{border:1px solid rgba(0,0,0,.14);border-right:0;border-bottom:0}
.card[data-side=below]::after{background:#F5F5F6}
.card .count{color:#4A4D57;font-weight:600}
.bar i{background:linear-gradient(90deg,#5D93F5,#2C66E4)}
.ring{box-shadow:0 0 0 2px #fff,0 0 0 5px var(--blue),0 0 0 9999px rgba(20,24,40,.14)}
.found{border-radius:999px;background:linear-gradient(180deg,#5D93F5,#2C66E4)}
.badge{border-radius:999px;background:#EAF1FF;color:#1E4FD8}
.tick{background:linear-gradient(180deg,#8DB6FF,#2C66E4);color:#fff}
.done{border-radius:12px}
.first{font-size:13px;padding:8px 10px;border-radius:10px;background:#EAF1FF;color:#1E4FD8;margin-top:8px}.first b{font-weight:700}
@media (prefers-reduced-motion:reduce){*,::before,::after{animation:none!important;transition:none!important}}
`;
