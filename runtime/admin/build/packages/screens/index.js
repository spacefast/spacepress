import '__i18n__';
var ee=Object.create;var O=Object.defineProperty;var te=Object.getOwnPropertyDescriptor;var ne=Object.getOwnPropertyNames;var re=Object.getPrototypeOf,ie=Object.prototype.hasOwnProperty;var b=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports);var se=(e,t,n,r)=>{if(t&&typeof t=="object"||typeof t=="function")for(let i of ne(t))!ie.call(e,i)&&i!==n&&O(e,i,{get:()=>t[i],enumerable:!(r=te(t,i))||r.enumerable});return e};var h=(e,t,n)=>(n=e!=null?ee(re(e)):{},se(t||!e||!e.__esModule?O(n,"default",{value:e,enumerable:!0}):n,e));var $=b((fe,V)=>{"use strict";V.exports=window.React});var T=b((ye,j)=>{"use strict";j.exports=window.ReactDOM});var B=b(C=>{"use strict";var D=T();C.createRoot=D.createRoot,C.hydrateRoot=D.hydrateRoot;var ge});var q=b((we,M)=>{"use strict";M.exports=window.wp.apiFetch});var J=b((be,H)=>{"use strict";H.exports=window.wp.components});var L=b((xe,G)=>{"use strict";G.exports=window.ReactJSXRuntime});var a=h($(),1),W=h(B(),1),x=h(q(),1),g=h(J(),1);import{DataForm as ae,DataViews as ce}from"@first-admin/dataviews";function v(e,t){return t?t.split(".").reduce((n,r)=>n!==null&&typeof n=="object"?n[r]:void 0,e):e}function U(e,t){let n=v(t,e.items);if(!Array.isArray(n))throw new Error(`The ${e.ability} output has no list at "${e.items??""}".`);return n.filter(r=>r!==null&&typeof r=="object")}var oe=/^\{item\.([A-Za-z0-9_.]+)\}$/;function X(e,t){let n=r=>{if(typeof r=="string"){let i=oe.exec(r);return i?v(t,i[1]):r}return Array.isArray(r)?r.map(n):r!==null&&typeof r=="object"?Object.fromEntries(Object.entries(r).map(([i,l])=>[i,n(l)])):r};return n(e.input??{})}function I(e){let t=`/wp-abilities/v1/abilities/${e.ability}/run`,n=e.input??{};if(Object.keys(n).length===0)return t;let r=new URLSearchParams,i=(l,u)=>{if(u!==null&&typeof u=="object")for(let[c,m]of Object.entries(u))i(`${l}[${c}]`,m);else r.append(l,String(u))};for(let[l,u]of Object.entries(n))i(`input[${l}]`,u);return`${t}?${r.toString()}`}function z(e){return e==="array"?"text":e??"text"}function R(e){return e==null?"\u2014":Array.isArray(e)?e.map(R).join(`
`):typeof e=="object"?JSON.stringify(e):String(e)}if(!document.head.querySelector("style[data-wp-hash='b128c50ae4']")){let e=document.createElement("style");e.setAttribute("data-wp-hash","b128c50ae4"),e.appendChild(document.createTextNode(`.first-admin-screen {
  gap: 16px;
  display: grid;
}

.first-admin-screen__value {
  white-space: pre-line;
}

.first-admin-screen__summary {
  margin: 0;
}

.first-admin-screen__form {
  gap: 16px;
  max-width: 760px;
  display: grid;
}

.first-admin-screen__confirm {
  justify-content: flex-end;
  gap: 8px;
  display: flex;
}

.first-admin-screen--classic {
  background: #fff;
  border: 1px solid #c3c4c7;
  margin-top: 16px;
  padding: 0 0 8px;
}

.first-admin-screen--classic .dataviews-wrapper {
  background: none;
}
`)),document.head.appendChild(e)}var s=h(L(),1);function _(e){return e&&typeof e=="object"&&"message"in e?String(e.message):String(e)}function le(e){return(0,x.default)({path:`/first-admin/v1/screens/${encodeURIComponent(e)}`})}function Y(e,t){let n=X(e,t),r=e.method??"POST",i=`/wp-abilities/v1/abilities/${e.ability}/run`;return r==="POST"?(0,x.default)({path:i,method:r,data:{input:n}}):(0,x.default)({path:I({ability:e.ability,input:n,fields:[]}),method:r})}function Z(e){return e.map(t=>({id:t.id,label:t.label??t.id,description:t.description,type:z(t.type),elements:t.elements,enableGlobalSearch:t.type===void 0||t.type==="text",getValue:({item:n})=>n[t.id],render:({item:n})=>(0,s.jsx)("span",{className:"first-admin-screen__value",children:R(n[t.id])})}))}function F({state:e}){return e.kind==="error"?(0,s.jsx)("div",{role:"alert",children:(0,s.jsx)(g.Notice,{status:"error",isDismissible:!1,children:e.message})}):(0,s.jsxs)("div",{role:"status",children:[(0,s.jsx)(g.Spinner,{})," Loading\u2026"]})}function de({screen:e,reload:t,setNotice:n}){let r=e.view,[i,l]=(0,a.useState)({kind:"loading"}),[u,c]=(0,a.useState)(0),[m,p]=(0,a.useState)(null);(0,a.useEffect)(()=>{let o=!0;return(0,x.default)({path:I(r)}).then(y=>o&&l({kind:"ready",value:U(r,y)})).catch(y=>o&&l({kind:"error",message:_(y)})),()=>{o=!1}},[r,t,u]);let f=(0,a.useMemo)(()=>Z(r.fields),[r]),[d,S]=(0,a.useState)(()=>({type:"table",perPage:20,page:1,fields:r.fields.map(o=>o.id),...r.layout})),k=(0,a.useCallback)(async(o,y)=>{try{await Y(o,y),n({status:"success",text:`${o.label}: done.`}),c(w=>w+1)}catch(w){n({status:"error",text:_(w)})}},[n]),K=e.actions.map(o=>({id:o.id,label:o.label,isDestructive:o.destructive,callback:y=>{let w=y[0];o.confirm?p({action:o,item:w}):k(o,w)}}));if(i.kind!=="ready")return(0,s.jsx)(F,{state:i});let N=(d.search??"").toLowerCase(),A=N?i.value.filter(o=>r.fields.some(y=>R(o[y.id]).toLowerCase().includes(N))):i.value,E=d.perPage??20,P=d.page??1,Q=r.id??"id";return(0,s.jsxs)(s.Fragment,{children:[(0,s.jsx)(ce,{data:A.slice((P-1)*E,P*E),fields:f,view:d,onChangeView:S,actions:K,getItemId:o=>String(v(o,Q)),defaultLayouts:{table:{}},paginationInfo:{totalItems:A.length,totalPages:Math.max(1,Math.ceil(A.length/E))}}),m&&(0,s.jsxs)(g.Modal,{title:m.action.label,onRequestClose:()=>p(null),size:"small",children:[(0,s.jsx)("p",{children:m.action.confirm}),(0,s.jsxs)("div",{className:"first-admin-screen__confirm",children:[(0,s.jsx)(g.Button,{variant:"tertiary",onClick:()=>p(null),children:"Cancel"}),(0,s.jsx)(g.Button,{variant:"primary",isDestructive:m.action.destructive,onClick:()=>{let{action:o,item:y}=m;p(null),k(o,y)},children:m.action.label})]})]})]})}function ue({screen:e,setNotice:t}){let n=e.form,[r,i]=(0,a.useState)({kind:"loading"}),[l,u]=(0,a.useState)({}),[c,m]=(0,a.useState)(!1);(0,a.useEffect)(()=>{let d=!0;return(0,x.default)({path:I(n)}).then(S=>{let k=v(S,n.item)??{};d&&(u(k),i({kind:"ready",value:k}))}).catch(S=>d&&i({kind:"error",message:_(S)})),()=>{d=!1}},[n]);let p=(0,a.useMemo)(()=>Z(n.fields).map(d=>({...d,render:void 0})),[n]);if(r.kind!=="ready")return(0,s.jsx)(F,{state:r});let f=n.submit;return(0,s.jsxs)("form",{className:"first-admin-screen__form",onSubmit:d=>{d.preventDefault(),!(!f||c)&&(m(!0),Y(f,l).then(()=>t({status:"success",text:"Saved."})).catch(S=>t({status:"error",text:_(S)})).finally(()=>m(!1)))},children:[(0,s.jsx)(ae,{data:l,fields:p,form:n.layout??{fields:n.fields.map(d=>d.id)},onChange:d=>u({...l,...d})}),f&&(0,s.jsx)(g.Button,{variant:"primary",type:"submit",isBusy:c,disabled:c,children:f.label})]})}function me({id:e,host:t,frame:n=(r,i)=>i}){let[r,i]=(0,a.useState)({kind:"loading"}),[l,u]=(0,a.useState)(null);if((0,a.useEffect)(()=>{let p=!0;return i({kind:"loading"}),le(e).then(f=>p&&i({kind:"ready",value:f})).catch(f=>p&&i({kind:"error",message:_(f)})),()=>{p=!1}},[e]),r.kind!=="ready")return n(null,(0,s.jsx)(F,{state:r}));let c=r.value,m=Array.isArray(c.data)?c.data:c.data==null?[]:[c.data];return n(c,(0,s.jsxs)("div",{className:`first-admin-screen first-admin-screen--${t}`,"data-screen":c.id,children:[l&&(0,s.jsx)(g.Notice,{status:l.status,onRemove:()=>u(null),children:l.text}),m.map((p,f)=>(0,s.jsx)("p",{className:"first-admin-screen__summary",children:R(p)},f)),c.view&&(0,s.jsx)(de,{screen:c,reload:0,setNotice:u}),c.form&&(0,s.jsx)(ue,{screen:c,setNotice:u})]}))}function _e(e,{id:t}){e&&(0,W.createRoot)(e).render((0,s.jsx)(me,{id:t,host:"classic"}))}export{me as ScreenBody,X as actionInput,v as at,R as display,le as fetchScreen,z as fieldType,U as items,_e as mountClassic,I as readPath,Y as runAction};
