import '__i18n__';
var et=Object.create;var K=Object.defineProperty;var nt=Object.getOwnPropertyDescriptor;var st=Object.getOwnPropertyNames;var at=Object.getPrototypeOf,rt=Object.prototype.hasOwnProperty;var v=(n,a)=>()=>(a||n((a={exports:{}}).exports,a),a.exports);var it=(n,a,i,m)=>{if(a&&typeof a=="object"||typeof a=="function")for(let u of st(a))!rt.call(n,u)&&u!==i&&K(n,u,{get:()=>a[u],enumerable:!(m=nt(a,u))||m.enumerable});return n};var g=(n,a,i)=>(i=n!=null?et(at(n)):{},it(a||!n||!n.__esModule?K(i,"default",{value:n,enumerable:!0}):i,n));var M=v((lt,$)=>{"use strict";$.exports=window.React});var U=v((yt,F)=>{"use strict";F.exports=window.wp.apiFetch});var G=v((mt,q)=>{"use strict";q.exports=window.wp.components});var L=v((ut,J)=>{"use strict";J.exports=window.wp.i18n});var _=v((gt,W)=>{"use strict";W.exports=window.ReactJSXRuntime});var l=g(M()),H=g(U()),p=g(G()),e=g(L());import{Page as dt}from"@typedpress-admin/admin-toolkit";if(!document.head.querySelector("style[data-wp-hash='e97d0d2ef8']")){let n=document.createElement("style");n.setAttribute("data-wp-hash","e97d0d2ef8"),n.appendChild(document.createTextNode(`.tp-identity-tabs {
  border-bottom: 1px solid var(--wpds-color-stroke-surface-neutral-weak);
  align-items: center;
  gap: 4px;
  padding: 0 24px;
  display: flex;
  overflow-x: auto;
}

.tp-identity-tab {
  appearance: none;
  white-space: nowrap;
  color: var(--wpds-color-foreground-content-neutral-weak);
  cursor: pointer;
  background: none;
  border: none;
  border-bottom: 2px solid #0000;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 500;
}

.tp-identity-tab:hover {
  color: var(--wpds-color-foreground-content-neutral);
}

.tp-identity-tab.is-active {
  color: var(--wpds-color-foreground-content-neutral);
  border-bottom-color: var(--wpds-color-foreground-interactive-brand);
}

.tp-identity-body {
  flex-direction: column;
  gap: 16px;
  display: flex;
}

.tp-identity-toolbar {
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  display: flex;
}

.tp-identity-card {
  border: 1px solid var(--wpds-color-stroke-surface-neutral);
  border-radius: var(--wpds-border-radius-lg);
  background: var(--wpds-color-background-surface-neutral-strong);
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px;
  display: flex;
}

.tp-identity-card h3 {
  margin: 0;
  font-size: 15px;
}

.tp-identity-table-wrap {
  border: 1px solid var(--wpds-color-stroke-surface-neutral);
  border-radius: var(--wpds-border-radius-lg);
  background: var(--wpds-color-background-surface-neutral-strong);
  overflow-x: auto;
}

.tp-identity-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}

.tp-identity-table th, .tp-identity-table td {
  text-align: left;
  border-bottom: 1px solid var(--wpds-color-stroke-surface-neutral-weak);
  vertical-align: middle;
  padding: 10px 14px;
}

.tp-identity-table th {
  color: var(--wpds-color-foreground-content-neutral-weak);
  background: var(--wpds-color-background-surface-neutral-weak);
  font-size: 12px;
  font-weight: 600;
}

.tp-identity-table tr:last-child td {
  border-bottom: none;
}

.tp-identity-badge {
  border-radius: var(--wpds-border-radius-sm);
  background: var(--wpds-color-background-surface-neutral-weak);
  color: var(--wpds-color-foreground-content-neutral);
  align-items: center;
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 500;
  display: inline-flex;
}

.tp-identity-badge.is-success {
  background: var(--wpds-color-background-surface-success-weak);
  color: var(--wpds-color-foreground-content-success);
}

.tp-identity-badge.is-warning {
  background: var(--wpds-color-background-surface-warning-weak);
  color: var(--wpds-color-foreground-content-warning);
}

.tp-identity-badge.is-error {
  background: var(--wpds-color-background-surface-error-weak);
  color: var(--wpds-color-foreground-content-error);
}

.tp-identity-form-grid {
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  align-items: end;
  gap: 12px;
  display: grid;
}

.tp-identity-muted {
  color: var(--wpds-color-foreground-content-neutral-weak);
}

.tp-identity-loading {
  color: var(--wpds-color-foreground-content-neutral-weak);
  align-items: center;
  gap: 8px;
  padding: 24px 0;
  display: flex;
}

.tp-identity-code {
  word-break: break-all;
  font-family: monospace;
  font-size: 12px;
}
`)),document.head.appendChild(n)}var t=g(_()),ot=[{key:"people",label:(0,e.__)("People","typedpress-admin")},{key:"organizations",label:(0,e.__)("Organizations","typedpress-admin")},{key:"applications",label:(0,e.__)("Applications","typedpress-admin")},{key:"sessions",label:(0,e.__)("Sessions","typedpress-admin")},{key:"authentication",label:(0,e.__)("Authentication","typedpress-admin")},{key:"security-events",label:(0,e.__)("Security Events","typedpress-admin")}];function X(n){if(n&&typeof n=="object"){let a=n;if(a.error&&typeof a.error=="object"&&"message"in a.error)return String(a.error.message);if("message"in a)return String(a.message)}return(0,e.__)("Unable to complete request.","typedpress-admin")}function x(n){if(n==null||n==="")return"\u2014";let a=typeof n=="number"?n:Number(n),i=!Number.isNaN(a)&&a>1e9?new Date(a>1e12?a:a*1e3):new Date(String(n));return Number.isNaN(i.getTime())?String(n):new Intl.DateTimeFormat(void 0,{dateStyle:"medium",timeStyle:"short"}).format(i)}async function b(n,a="GET",i){let m=await(0,H.default)({path:`/typedpress-identity/v1/admin/${n}`,method:a,data:i});return m&&typeof m=="object"&&"data"in m?m.data:m}function pt(){let n="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-",a="";for(let i=0;i<24;i++)a+=n[Math.floor(Math.random()*n.length)];return a}function T(){let[n,a]=(0,l.useState)("people"),[i,m]=(0,l.useState)(null),[u,A]=(0,l.useState)(!0),[h,C]=(0,l.useState)(!1),[O,f]=(0,l.useState)(""),[z,R]=(0,l.useState)(""),[Q,V]=(0,l.useState)(0),[k,D]=(0,l.useState)(""),[N,E]=(0,l.useState)(""),[S,P]=(0,l.useState)(""),[B,I]=(0,l.useState)(null),j=(0,l.useCallback)(()=>V(c=>c+1),[]);(0,l.useEffect)(()=>{let c=!0;return A(!0),f(""),b(n).then(r=>{c&&(m(r),A(!1))}).catch(r=>{c&&(f(X(r)),A(!1))}),()=>{c=!1}},[n,Q]);let w=async(c,r)=>{C(!0),f(""),R("");try{await c(),R(r),j()}catch(s){f(X(s))}finally{C(!1)}},Y=()=>{if(u)return(0,t.jsxs)("div",{className:"tp-identity-loading",children:[(0,t.jsx)(p.Spinner,{}),(0,t.jsx)("span",{children:(0,e.__)("Loading\u2026","typedpress-admin")})]});if(n==="people"){let r=Array.isArray(i)?i:[];return(0,t.jsx)("div",{className:"tp-identity-table-wrap",children:(0,t.jsxs)("table",{className:"tp-identity-table",children:[(0,t.jsx)("thead",{children:(0,t.jsxs)("tr",{children:[(0,t.jsx)("th",{children:(0,e.__)("Person","typedpress-admin")}),(0,t.jsx)("th",{children:(0,e.__)("Email","typedpress-admin")}),(0,t.jsx)("th",{children:(0,e.__)("Status","typedpress-admin")}),(0,t.jsx)("th",{children:(0,e.__)("MFA","typedpress-admin")}),(0,t.jsx)("th",{children:(0,e.__)("Actions","typedpress-admin")})]})}),(0,t.jsx)("tbody",{children:r.length===0?(0,t.jsx)("tr",{children:(0,t.jsx)("td",{colSpan:5,className:"tp-identity-muted",children:(0,e.__)("No accounts found.","typedpress-admin")})}):r.map(s=>{let d=String(s.id??s.wp_user_id??""),o=s.status==="suspended"||s.suspended===!0;return(0,t.jsxs)("tr",{children:[(0,t.jsx)("td",{children:(0,t.jsx)("strong",{children:String(s.display_name??s.name??`#${d}`)})}),(0,t.jsx)("td",{children:String(s.email??"\u2014")}),(0,t.jsx)("td",{children:(0,t.jsx)("span",{className:`tp-identity-badge ${o?"is-error":"is-success"}`,children:String(s.status??(o?"suspended":"active"))})}),(0,t.jsx)("td",{children:(0,t.jsx)("span",{className:`tp-identity-badge ${s.mfa_enabled?"is-success":""}`,children:s.mfa_enabled?(0,e.__)("Enabled","typedpress-admin"):(0,e.__)("Off","typedpress-admin")})}),(0,t.jsx)("td",{children:(0,t.jsx)(p.Button,{variant:"secondary",size:"small",disabled:h,onClick:()=>void w(()=>b("people/suspend","POST",{id:d,suspended:!o}),o?(0,e.__)("Account reactivated.","typedpress-admin"):(0,e.__)("Account suspended.","typedpress-admin")),children:o?(0,e.__)("Reactivate","typedpress-admin"):(0,e.__)("Suspend","typedpress-admin")})})]},d)})})]})})}if(n==="organizations"){let r=Array.isArray(i)?i:[];return(0,t.jsx)("div",{className:"tp-identity-table-wrap",children:(0,t.jsxs)("table",{className:"tp-identity-table",children:[(0,t.jsx)("thead",{children:(0,t.jsxs)("tr",{children:[(0,t.jsx)("th",{children:(0,e.__)("Name","typedpress-admin")}),(0,t.jsx)("th",{children:(0,e.__)("Slug","typedpress-admin")}),(0,t.jsx)("th",{children:(0,e.__)("Created","typedpress-admin")})]})}),(0,t.jsx)("tbody",{children:r.length===0?(0,t.jsx)("tr",{children:(0,t.jsx)("td",{colSpan:3,className:"tp-identity-muted",children:(0,e.__)("No organizations yet.","typedpress-admin")})}):r.map((s,d)=>(0,t.jsxs)("tr",{children:[(0,t.jsx)("td",{children:(0,t.jsx)("strong",{children:String(s.name??"\u2014")})}),(0,t.jsx)("td",{className:"tp-identity-code",children:String(s.slug??s.id??"\u2014")}),(0,t.jsx)("td",{children:x(s.created_at)})]},String(s.id??d)))})]})})}if(n==="applications"){let r=Array.isArray(i)?i:[];return(0,t.jsxs)(t.Fragment,{children:[(0,t.jsxs)("form",{className:"tp-identity-card",onSubmit:s=>{s.preventDefault(),!(!k.trim()||!N.trim()||!S.trim())&&w(async()=>{let d=await b("applications","POST",{name:k.trim(),redirect_uri:N.trim(),origin:S.trim(),idempotency_key:pt()});d&&typeof d.client_secret=="string"&&I(d.client_secret),D(""),E(""),P("")},(0,e.__)("OAuth application registered.","typedpress-admin"))},children:[(0,t.jsx)("h3",{children:(0,e.__)("Register OAuth Application","typedpress-admin")}),(0,t.jsxs)("div",{className:"tp-identity-form-grid",children:[(0,t.jsx)(p.TextControl,{label:(0,e.__)("Name","typedpress-admin"),value:k,onChange:D,placeholder:"My Client App"}),(0,t.jsx)(p.TextControl,{label:(0,e.__)("Redirect URI","typedpress-admin"),value:N,onChange:E,placeholder:"https://app.example.com/callback"}),(0,t.jsx)(p.TextControl,{label:(0,e.__)("Allowed Origin","typedpress-admin"),value:S,onChange:P,placeholder:"https://app.example.com"}),(0,t.jsx)(p.Button,{type:"submit",variant:"primary",disabled:h||!k.trim()||!N.trim()||!S.trim(),children:(0,e.__)("Add Application","typedpress-admin")})]}),B&&(0,t.jsxs)(p.Notice,{status:"warning",isDismissible:!0,onRemove:()=>I(null),children:[(0,t.jsx)("strong",{children:(0,e.__)("Client secret (shown once):","typedpress-admin")})," ",(0,t.jsx)("code",{className:"tp-identity-code",children:B})]})]}),(0,t.jsx)("div",{className:"tp-identity-table-wrap",children:(0,t.jsxs)("table",{className:"tp-identity-table",children:[(0,t.jsx)("thead",{children:(0,t.jsxs)("tr",{children:[(0,t.jsx)("th",{children:(0,e.__)("Name","typedpress-admin")}),(0,t.jsx)("th",{children:(0,e.__)("Client ID","typedpress-admin")}),(0,t.jsx)("th",{children:(0,e.__)("Origin","typedpress-admin")}),(0,t.jsx)("th",{children:(0,e.__)("Status","typedpress-admin")}),(0,t.jsx)("th",{children:(0,e.__)("Actions","typedpress-admin")})]})}),(0,t.jsx)("tbody",{children:r.length===0?(0,t.jsx)("tr",{children:(0,t.jsx)("td",{colSpan:5,className:"tp-identity-muted",children:(0,e.__)("No OAuth applications registered.","typedpress-admin")})}):r.map(s=>{let d=String(s.id??""),o=s.enabled===!0||s.enabled===1||s.enabled==="1";return(0,t.jsxs)("tr",{children:[(0,t.jsx)("td",{children:(0,t.jsx)("strong",{children:String(s.name??"\u2014")})}),(0,t.jsx)("td",{className:"tp-identity-code",children:d}),(0,t.jsx)("td",{className:"tp-identity-code",children:String(s.origin??"\u2014")}),(0,t.jsx)("td",{children:(0,t.jsx)("span",{className:`tp-identity-badge ${o?"is-success":"is-warning"}`,children:o?(0,e.__)("Enabled","typedpress-admin"):(0,e.__)("Disabled","typedpress-admin")})}),(0,t.jsx)("td",{children:(0,t.jsx)(p.Button,{variant:"secondary",size:"small",disabled:h,onClick:()=>void w(()=>b("applications/status","POST",{id:d,enabled:!o}),o?(0,e.__)("Application disabled.","typedpress-admin"):(0,e.__)("Application enabled.","typedpress-admin")),children:o?(0,e.__)("Disable","typedpress-admin"):(0,e.__)("Enable","typedpress-admin")})})]},d)})})]})})]})}if(n==="sessions"){let r=Array.isArray(i)?i:[];return(0,t.jsx)("div",{className:"tp-identity-table-wrap",children:(0,t.jsxs)("table",{className:"tp-identity-table",children:[(0,t.jsx)("thead",{children:(0,t.jsxs)("tr",{children:[(0,t.jsx)("th",{children:(0,e.__)("Session","typedpress-admin")}),(0,t.jsx)("th",{children:(0,e.__)("User ID","typedpress-admin")}),(0,t.jsx)("th",{children:(0,e.__)("Created","typedpress-admin")}),(0,t.jsx)("th",{children:(0,e.__)("Expires","typedpress-admin")}),(0,t.jsx)("th",{children:(0,e.__)("Status","typedpress-admin")}),(0,t.jsx)("th",{children:(0,e.__)("Actions","typedpress-admin")})]})}),(0,t.jsx)("tbody",{children:r.length===0?(0,t.jsx)("tr",{children:(0,t.jsx)("td",{colSpan:6,className:"tp-identity-muted",children:(0,e.__)("No sessions recorded.","typedpress-admin")})}):r.map(s=>{let d=String(s.id??""),o=String(s.wp_user_id??""),y=!!s.revoked_at;return(0,t.jsxs)("tr",{children:[(0,t.jsx)("td",{children:(0,t.jsx)("strong",{children:String(s.label||d.slice(0,12))})}),(0,t.jsxs)("td",{children:["#",o]}),(0,t.jsx)("td",{children:x(s.created_at)}),(0,t.jsx)("td",{children:x(s.expires_at)}),(0,t.jsx)("td",{children:(0,t.jsx)("span",{className:`tp-identity-badge ${y?"is-error":"is-success"}`,children:y?(0,e.__)("Revoked","typedpress-admin"):(0,e.__)("Active","typedpress-admin")})}),(0,t.jsx)("td",{children:!y&&(0,t.jsx)(p.Button,{variant:"secondary",size:"small",isDestructive:!0,disabled:h,onClick:()=>void w(()=>b("sessions/revoke","POST",{user_id:o,id:d}),(0,e.__)("Session revoked.","typedpress-admin")),children:(0,e.__)("Revoke","typedpress-admin")})})]},d)})})]})})}if(n==="authentication"){let r=i&&typeof i=="object"?i:{},s=Array.isArray(r.providers)?r.providers.map(String):[],d=r.keys&&typeof r.keys=="object"?r.keys:{},o=Array.isArray(d.keys)?d.keys:[];return(0,t.jsxs)(t.Fragment,{children:[(0,t.jsxs)("div",{className:"tp-identity-card",children:[(0,t.jsx)("h3",{children:(0,e.__)("Sign-in Providers","typedpress-admin")}),s.length===0?(0,t.jsx)("p",{className:"tp-identity-muted",children:(0,e.__)("Email & password sign-in active. No external OAuth providers configured.","typedpress-admin")}):(0,t.jsx)("div",{children:s.map(y=>(0,t.jsx)("span",{className:"tp-identity-badge is-success",style:{marginInlineEnd:6},children:y},y))})]}),(0,t.jsxs)("div",{className:"tp-identity-card",children:[(0,t.jsxs)("div",{className:"tp-identity-toolbar",children:[(0,t.jsx)("h3",{children:(0,e.__)("Signing Keys (JWKS)","typedpress-admin")}),(0,t.jsx)(p.Button,{variant:"secondary",disabled:h,onClick:()=>void w(()=>b("keys/rotate","POST"),(0,e.__)("Signing keys rotated.","typedpress-admin")),children:(0,e.__)("Rotate Keys","typedpress-admin")})]}),(0,t.jsxs)("p",{className:"tp-identity-muted",children:[o.length," ",(0,e.__)("active signing key(s).","typedpress-admin")]}),o.map((y,tt)=>(0,t.jsxs)("div",{className:"tp-identity-code",children:["kid: ",String(y.kid??"\u2014")," (",String(y.alg??y.kty??""),")"]},String(y.kid??tt)))]})]})}let c=Array.isArray(i)?i:[];return(0,t.jsx)("div",{className:"tp-identity-table-wrap",children:(0,t.jsxs)("table",{className:"tp-identity-table",children:[(0,t.jsx)("thead",{children:(0,t.jsxs)("tr",{children:[(0,t.jsx)("th",{children:(0,e.__)("Event","typedpress-admin")}),(0,t.jsx)("th",{children:(0,e.__)("User ID","typedpress-admin")}),(0,t.jsx)("th",{children:(0,e.__)("Time","typedpress-admin")})]})}),(0,t.jsx)("tbody",{children:c.length===0?(0,t.jsx)("tr",{children:(0,t.jsx)("td",{colSpan:3,className:"tp-identity-muted",children:(0,e.__)("No security events recorded.","typedpress-admin")})}):c.map((r,s)=>(0,t.jsxs)("tr",{children:[(0,t.jsx)("td",{className:"tp-identity-code",children:String(r.kind??r.event??r.type??"\u2014")}),(0,t.jsx)("td",{children:r.wp_user_id?`#${String(r.wp_user_id)}`:"\u2014"}),(0,t.jsx)("td",{children:x(r.created_at??r.occurred_at)})]},String(r.id??s)))})]})})},Z=(0,t.jsx)("div",{className:"tp-identity-tabs",role:"tablist",children:ot.map(c=>(0,t.jsx)("button",{type:"button",role:"tab","aria-selected":n===c.key,className:`tp-identity-tab${n===c.key?" is-active":""}`,onClick:()=>a(c.key),children:c.label},c.key))});return(0,t.jsx)(dt,{title:(0,e.__)("Identity & Auth","typedpress-admin"),subTitle:(0,e.__)("Accounts, organizations, OAuth applications, sessions, and security logs.","typedpress-admin"),tabs:Z,actions:(0,t.jsx)(p.Button,{variant:"secondary",size:"compact",onClick:j,children:(0,e.__)("Refresh","typedpress-admin")}),children:(0,t.jsxs)("div",{className:"tp-identity-body",children:[O&&(0,t.jsx)(p.Notice,{status:"error",isDismissible:!0,onRemove:()=>f(""),children:O}),z&&(0,t.jsx)(p.Notice,{status:"success",isDismissible:!0,onRemove:()=>R(""),children:z}),Y()]})})}var vt=T,kt=void 0,Nt="/identity";export{kt as inspector,Nt as path,vt as stage};
