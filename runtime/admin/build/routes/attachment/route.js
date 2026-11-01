import '__i18n__';
var Ia=Object.create;var it=Object.defineProperty;var Na=Object.getOwnPropertyDescriptor;var Aa=Object.getOwnPropertyNames;var Pa=Object.getPrototypeOf,La=Object.prototype.hasOwnProperty;var f=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports);var Da=(e,t,a,r)=>{if(t&&typeof t=="object"||typeof t=="function")for(let i of Aa(t))!La.call(e,i)&&i!==a&&it(e,i,{get:()=>t[i],enumerable:!(r=Na(t,i))||r.enumerable});return e};var o=(e,t,a)=>(a=e!=null?Ia(Pa(e)):{},Da(t||!e||!e.__esModule?it(a,"default",{value:e,enumerable:!0}):a,e));var b=f((vo,dt)=>{"use strict";dt.exports=window.wp.coreData});var w=f((ko,nt)=>{"use strict";nt.exports=window.wp.data});var M=f((Eo,st)=>{"use strict";st.exports=window.wp.editor});var S=f((Ro,lt)=>{"use strict";lt.exports=window.wp.components});var E=f((zo,ft)=>{"use strict";ft.exports=window.wp.i18n});var R=f((Mo,mt)=>{"use strict";mt.exports=window.wp.element});var Y=f((So,ut)=>{"use strict";ut.exports=window.wp.compose});var n=f((Co,pt)=>{"use strict";pt.exports=window.ReactJSXRuntime});var ye=f((Ao,bt)=>{"use strict";bt.exports=window.wp.notices});var zt=f((Do,Rt)=>{"use strict";Rt.exports=window.wp.keycodes});var St=f((Bo,Mt)=>{"use strict";Mt.exports=window.wp.commands});var Tt=f((Vo,Ct)=>{"use strict";Ct.exports=window.wp.dom});var x=f((Uo,Nt)=>{"use strict";Nt.exports=window.React});var v=f((Oo,At)=>{"use strict";At.exports=window.wp.primitives});var Ca=o(b()),X=o(w()),at=o(M());import{notFound as Ma}from"@wordpress/route";import{preloadFieldCollections as wo}from"@zero-admin/core-data-next";import{unlock as Sa}from"@zero-admin/admin-toolkit";if(!document.head.querySelector("style[data-wp-hash='7af6180997']")){let e=document.createElement("style");e.setAttribute("data-wp-hash","7af6180997"),e.appendChild(document.createTextNode(`:root {
  --wp-block-synced-color: #7a00df;
  --wp-block-synced-color--rgb: 122, 0, 223;
  --wp-bound-block-color: var(--wp-block-synced-color);
  --wp-editor-canvas-background: #ddd;
  --wp-admin-theme-color: #007cba;
  --wp-admin-theme-color--rgb: 0, 124, 186;
  --wp-admin-theme-color-darker-10: #006ba1;
  --wp-admin-theme-color-darker-10--rgb: 0, 107, 160.5;
  --wp-admin-theme-color-darker-20: #005a87;
  --wp-admin-theme-color-darker-20--rgb: 0, 90, 135;
  --wp-admin-border-width-focus: 2px;
}

@media (resolution >= 192dpi) {
  :root {
    --wp-admin-border-width-focus: 1.5px;
  }
}

.fields-create-template-part-modal {
  z-index: 1000001;
}

.fields-create-template-part-modal__area-fieldset {
  border: 0;
  margin: 0;
  padding: 0;
}

.fields-create-template-part-modal__area-radio-group {
  border: 1px solid #949494;
  border-radius: 2px;
}

.fields-create-template-part-modal__area-radio-wrapper {
  grid-gap: 4px 8px;
  color: #1e1e1e;
  grid-template-columns: min-content 1fr min-content;
  align-items: center;
  padding: 12px;
  display: grid;
  position: relative;
}

.fields-create-template-part-modal__area-radio-wrapper + .fields-create-template-part-modal__area-radio-wrapper {
  border-top: 1px solid #949494;
}

.fields-create-template-part-modal__area-radio-wrapper input[type="radio"] {
  opacity: 0;
  position: absolute;
}

.fields-create-template-part-modal__area-radio-wrapper:has(input[type="radio"]:checked) {
  z-index: 1;
}

.fields-create-template-part-modal__area-radio-wrapper:has(input[type="radio"]:not(:checked)):hover {
  color: var(--wp-admin-theme-color);
}

.fields-create-template-part-modal__area-radio-wrapper > :not(.fields-create-template-part-modal__area-radio-label) {
  pointer-events: none;
}

.fields-create-template-part-modal__area-radio-label:before {
  content: "";
  position: absolute;
  inset: 0;
}

input[type="radio"]:not(:checked) ~ .fields-create-template-part-modal__area-radio-label:before {
  cursor: var(--wpds-cursor-control, pointer);
}

input[type="radio"]:focus-visible ~ .fields-create-template-part-modal__area-radio-label:before {
  box-shadow: 0 0 0 var(--wp-admin-border-width-focus) var(--wp-admin-theme-color);
  outline: 4px solid #0000;
}

.fields-create-template-part-modal__area-radio-icon, .fields-create-template-part-modal__area-radio-checkmark {
  fill: currentColor;
}

input[type="radio"]:not(:checked) ~ .fields-create-template-part-modal__area-radio-checkmark {
  opacity: 0;
}

.fields-create-template-part-modal__area-radio-description {
  color: #757575;
  text-wrap: pretty;
  grid-column: 2 / 3;
  margin: 0;
  font-size: 12px;
  line-height: normal;
}

input[type="radio"]:not(:checked):hover ~ .fields-create-template-part-modal__area-radio-description {
  color: inherit;
}

fieldset.fields__media-edit {
  border: 0;
  width: 100%;
  margin: 0;
  padding: 0;
}

fieldset.fields__media-edit .components-base-control__label {
  color: #1e1e1e;
}

fieldset.fields__media-edit .fields__media-edit-description {
  font-size: 12px;
  line-height: 1.5;
}

fieldset.fields__media-edit {
  container-type: inline-size;
}

fieldset.fields__media-edit .fields__media-edit-compact-group {
  border: 1px dashed #949494;
  border-radius: 4px;
  overflow: hidden;
}

fieldset.fields__media-edit .fields__media-edit-compact-group.is-single {
  border-radius: 2px;
}

fieldset.fields__media-edit .fields__media-edit-compact-group .fields__media-edit-picker-button {
  border: 0;
  border-radius: 0;
}

fieldset.fields__media-edit .fields__media-edit-compact-group .fields__media-edit-picker-button:focus-visible {
  box-shadow: inset 0 0 0 var(--wp-admin-border-width-focus) var(--wp-admin-theme-color);
}

fieldset.fields__media-edit .fields__media-edit-compact-group .fields__media-edit-compact:not(:last-child) {
  border-bottom: 1px solid #f0f0f0;
}

fieldset.fields__media-edit .fields__media-edit-compact .components-drop-zone .components-drop-zone__content-inner {
  align-items: center;
  gap: 8px;
  display: flex;
}

fieldset.fields__media-edit .fields__media-edit-compact .components-drop-zone .components-drop-zone__content-inner .components-drop-zone__content-icon {
  margin: 0;
}

fieldset.fields__media-edit .fields__media-edit-compact {
  min-width: 0;
  position: relative;
}

fieldset.fields__media-edit .fields__media-edit-compact:hover .fields__media-edit-compact-movers, fieldset.fields__media-edit .fields__media-edit-compact:focus-within .fields__media-edit-compact-movers {
  opacity: 1;
}

fieldset.fields__media-edit .fields__media-edit-compact .fields__media-edit-compact-movers {
  opacity: 0;
  pointer-events: none;
  z-index: 1;
  background: #fff;
  border-radius: 2px;
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
}

fieldset.fields__media-edit .fields__media-edit-compact .fields__media-edit-compact-movers * {
  pointer-events: auto;
}

fieldset.fields__media-edit .fields__media-edit-picker-button:has(.fields__media-edit-placeholder):not(.fields__media-edit-expanded *) .components-drop-zone .components-drop-zone__content-inner {
  align-items: center;
  gap: 8px;
  display: flex;
}

fieldset.fields__media-edit .fields__media-edit-picker-button:has(.fields__media-edit-placeholder):not(.fields__media-edit-expanded *) .components-drop-zone .components-drop-zone__content-inner .components-drop-zone__content-icon {
  margin: 0;
}

fieldset.fields__media-edit .fields__media-edit-picker-button {
  min-height: 40px;
  cursor: var(--wpds-cursor-control, pointer);
  border: 1px dashed #949494;
  border-radius: 2px;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 4px 8px;
  display: flex;
  position: relative;
}

fieldset.fields__media-edit .fields__media-edit-picker-button:not(.has-attachment) {
  border-color: var(--wp-admin-theme-color);
  color: var(--wp-admin-theme-color);
}

fieldset.fields__media-edit .fields__media-edit-picker-button:not(.has-attachment):hover {
  background-color: color-mix(in srgb, var(--wp-admin-theme-color, #3858e9) 4%, transparent);
  color: var(--wp-admin-theme-color-darker-20);
  border-color: var(--wp-admin-theme-color-darker-20);
}

fieldset.fields__media-edit .fields__media-edit-picker-button:hover {
  color: var(--wp-admin-theme-color);
}

fieldset.fields__media-edit .fields__media-edit-picker-button:focus-visible {
  box-shadow: 0 0 0 var(--wp-admin-border-width-focus) var(--wp-admin-theme-color);
  outline: none;
}

fieldset.fields__media-edit .fields__media-edit-picker-button[aria-disabled="true"] {
  opacity: .6;
  cursor: default;
}

fieldset.fields__media-edit .fields__media-edit-picker-button .fields__media-edit-picker-button-spinner {
  z-index: 1;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

fieldset.fields__media-edit .fields__media-edit-filename, fieldset.fields__media-edit .fields__media-edit-placeholder {
  flex: 1;
  width: 100%;
  min-width: 0;
}

fieldset.fields__media-edit .fields__media-edit-placeholder {
  text-align: center;
}

fieldset.fields__media-edit .fields__media-edit-thumbnail {
  aspect-ratio: 1;
  border-radius: 2px;
  flex-shrink: 0;
  width: 24px;
}

fieldset.fields__media-edit .fields__media-edit-expanded {
  gap: 8px;
  display: grid;
}

fieldset.fields__media-edit .fields__media-edit-expanded.is-empty .components-drop-zone .components-drop-zone__content-inner {
  align-items: center;
  gap: 8px;
  display: flex;
}

fieldset.fields__media-edit .fields__media-edit-expanded.is-empty .components-drop-zone .components-drop-zone__content-inner .components-drop-zone__content-icon {
  margin: 0;
}

fieldset.fields__media-edit .fields__media-edit-expanded .fields__media-edit-expanded-preview {
  width: 100%;
  aspect-ratio: var(--fields-media-edit-expanded-multiple-aspect-ratio, 3/2);
  border-radius: 2px;
  justify-content: center;
  align-items: center;
  padding: 4px;
  display: flex;
  position: relative;
  overflow: hidden;
}

fieldset.fields__media-edit .fields__media-edit-expanded .fields__media-edit-expanded-preview .fields__media-edit-expanded-preview-stack {
  width: 100%;
  height: 100%;
}

fieldset.fields__media-edit .fields__media-edit-expanded .fields__media-edit-expanded-overlay {
  opacity: 0;
  pointer-events: none;
  position: absolute;
  inset: 0;
}

fieldset.fields__media-edit .fields__media-edit-expanded .fields__media-edit-expanded-overlay * {
  pointer-events: auto;
}

fieldset.fields__media-edit .fields__media-edit-expanded .fields__media-edit-expanded-actions {
  background: #fff;
  border-radius: 2px;
  position: absolute;
  top: 4px;
  right: 4px;
}

fieldset.fields__media-edit .fields__media-edit-expanded .fields__media-edit-expanded-item {
  border-radius: 4px;
  min-width: 0;
  position: relative;
}

fieldset.fields__media-edit .fields__media-edit-expanded .fields__media-edit-expanded-item:hover .fields__media-edit-expanded-overlay, fieldset.fields__media-edit .fields__media-edit-expanded .fields__media-edit-expanded-item:focus-within .fields__media-edit-expanded-overlay {
  opacity: 1;
}

fieldset.fields__media-edit .fields__media-edit-expanded .fields__media-edit-expanded-item:not(.has-preview-image) .fields__media-edit-expanded-preview-stack {
  padding: 8px;
}

fieldset.fields__media-edit .fields__media-edit-expanded .fields__media-edit-thumbnail {
  -o-object-fit: cover;
  object-fit: cover;
  -o-object-position: 50% 50%;
  object-position: 50% 50%;
  width: 100%;
  height: 100%;
}

fieldset.fields__media-edit .fields__media-edit-expanded .fields__media-edit-filename {
  text-align: center;
  flex: none;
}

fieldset.fields__media-edit .fields__media-edit-expanded .fields__media-edit-picker-button-spinner svg {
  margin: 0;
}

fieldset.fields__media-edit .fields__media-edit-expanded.is-single {
  grid-template-columns: 1fr;
}

fieldset.fields__media-edit .fields__media-edit-expanded.is-single .fields__media-edit-expanded-preview {
  aspect-ratio: 2;
}

fieldset.fields__media-edit .fields__media-edit-expanded .fields__media-edit-picker-button {
  border-radius: 4px;
}

fieldset.fields__media-edit .fields__media-edit-expanded.is-empty .fields__media-edit-picker-button {
  border-radius: 2px;
}

fieldset.fields__media-edit .fields__media-edit-expanded.is-multiple:not(.is-empty) {
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
}

@container (width <= 500px) {
  fieldset.fields__media-edit .fields__media-edit-expanded.is-multiple:not(.is-empty) {
    grid-template-columns: repeat(auto-fill, minmax(105px, 1fr));
  }
}

fieldset.fields__media-edit .fields__media-edit-expanded:not(.is-empty) .fields__media-edit-picker-button {
  padding: 0;
}

fieldset.fields__media-edit .fields__media-edit-expanded:not(.is-empty) .fields__media-edit-placeholder {
  aspect-ratio: var(--fields-media-edit-expanded-multiple-aspect-ratio, 3/2);
  justify-content: center;
  align-items: center;
  display: flex;
}

.fields-controls__author-avatar {
  flex-shrink: 0;
  justify-content: left;
  align-items: center;
  width: 24px;
  height: 24px;
  display: flex;
  overflow: hidden;
}

.fields-controls__author-avatar img {
  -o-object-fit: cover;
  object-fit: cover;
  opacity: 0;
  border-radius: 100%;
  width: 16px;
  height: 16px;
}

@media not (prefers-reduced-motion) {
  .fields-controls__author-avatar img {
    transition: opacity .1s linear;
  }
}

.fields-controls__author-avatar.is-loaded img {
  opacity: 1;
}

.fields-controls__author-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
}

.fields-controls__author-icon svg {
  fill: currentColor;
  margin-left: -4px;
}

.fields-controls__author-name {
  text-overflow: ellipsis;
  overflow: hidden;
}

.fields-controls__slug {
  border: 0;
  margin: 0;
  padding: 0;
}

.fields-controls__slug .fields-controls__slug-external-icon {
  margin-left: 5ch;
}

.fields-controls__slug .fields-controls__slug-input input.components-input-control__input {
  padding-inline-start: 0 !important;
}

.fields-controls__slug .fields-controls__slug-help-link {
  word-break: break-word;
}

.fields-controls__slug .fields-controls__slug-help {
  flex-direction: column;
  display: flex;
}

.fields-controls__slug .fields-controls__slug-help .fields-controls__slug-help-slug {
  font-weight: var(--wpds-typography-font-weight-emphasis, 600);
}

.fields-controls__featured-image-image, .fields-controls__featured-image-placeholder {
  border-radius: 4px;
  width: 100%;
  height: 100%;
  display: block;
}

.fields-controls__featured-image-placeholder {
  box-shadow: none;
  background: #f0f0f0;
}

.fields-controls__parent, .fields-controls__password {
  border: 0;
  margin: 0;
  padding: 0;
}

.fields-controls__status-icon {
  width: 24px;
  height: 24px;
}

.fields-controls__status-icon svg {
  fill: currentColor;
  margin-left: -4px;
}

.fields-field__title > span:first-child {
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-grow: 0;
  text-decoration: none;
  display: block;
  overflow: hidden;
}

.fields-field__pattern-title span:first-child {
  flex: 1;
}
`)),document.head.appendChild(e)}var Ea=o(b()),Ra=o(S()),za=o(E());var ht=o(b());var he=o(R()),ct=o(Y()),_e=o(n()),Ba=(0,he.createContext)({}),Va=(0,ct.createHigherOrderComponent)(e=>{let t=({...a})=>(0,_e.jsx)(Ba.Provider,{value:{},children:(0,_e.jsx)(e,{...a})});return t.displayName=`withMediaEditorStateProvider(${e.displayName||e.name||"Component"})`,t},"withMediaEditorStateProvider"),_t=Va;var gt=o(n()),ja=_t(({post:e,children:t})=>e?(0,gt.jsx)(ht.EntityProvider,{kind:"postType",type:"attachment",id:e.id,children:t}):null),yt=ja;var va=o(M()),ka=o(E());import{unlock as ho}from"@zero-admin/admin-toolkit";import{useLinkProps as yo}from"@wordpress/route";var wt=o(S()),W=o(w()),ge=o(ye()),xt=o(n()),Ua=-3;function be(){let e=(0,W.useSelect)(r=>r(ge.store).getNotices(),[]),{removeNotice:t}=(0,W.useDispatch)(ge.store),a=e.filter(({type:r})=>r==="snackbar").slice(Ua);return(0,xt.jsx)(wt.SnackbarList,{notices:a,className:"components-editor-notices__snackbar",onRemove:t})}var Ft=o(w()),qt=o(M()),ne=o(b()),$t=o(Y());import{SiteIconBackButton as Ha,unlock as Fa}from"@zero-admin/admin-toolkit";var Z=o(E()),vt=o(S()),we=o(b()),D=o(w()),kt=o(ye()),J=o(R()),Et=o(n());function xe({postId:e}){let{post:t,isDisabled:a,isEntityRecordDirty:r,isSaving:i}=(0,D.useSelect)(L=>{let{hasEditsForEntityRecord:ce,isSavingEntityRecord:u,getEditedEntityRecord:Ta}=L(we.store),ot=ce("postType","attachment",e),rt=u("postType","attachment",e);return{isEntityRecordDirty:ot,isSaving:rt,isDisabled:rt||!ot,post:Ta("postType","attachment",e)}},[e]),{createSuccessNotice:d,createErrorNotice:s}=(0,D.useDispatch)(kt.store),{invalidateResolution:m,saveEditedEntityRecord:p}=(0,D.useDispatch)(we.store),l=(0,J.useCallback)(()=>{m("getEntityRecord",["postType","attachment",e,{_embed:"wp:attached-to"}])},[m,e]),y=(0,J.useCallback)(async()=>{try{return await p("postType","attachment",e,{throwOnError:!0,isCached:!1})}catch{s((0,Z.__)("Could not save attachment.","zero-admin"),{id:"attachment-save-error",type:"snackbar"})}},[p,e,s]),k=(0,J.useCallback)(async()=>{!r||!await y()||(d((0,Z.__)("Media saved","zero-admin"),{id:"attachments-save-success",type:"snackbar"}),l())},[y,r,d,l]);return(0,Et.jsx)(vt.Button,{variant:"primary",size:"compact",onClick:k,isBusy:i,disabled:a,accessibleWhenDisabled:!0,children:(0,Z.__)("Save","zero-admin")})}var Bt=o(E()),Vt=o(w()),C=o(S()),jt=o(zt()),Ut=o(St()),ie=o(R()),Ot=o(Y()),Ht=o(Tt());function It(e){var t,a,r="";if(typeof e=="string"||typeof e=="number")r+=e;else if(typeof e=="object")if(Array.isArray(e)){var i=e.length;for(t=0;t<i;t++)e[t]&&(a=It(e[t]))&&(r&&(r+=" "),r+=a)}else for(a in e)e[a]&&(r&&(r+=" "),r+=a);return r}function Oa(){for(var e,t,a=0,r="",i=arguments.length;a<i;a++)(e=arguments[a])&&(t=It(e))&&(r&&(r+=" "),r+=t);return r}var K=Oa;var Pt=o(R(),1),Lt=o(v(),1),Dt=o(n(),1),B=(0,Pt.forwardRef)(function({icon:t,size:a=24,...r},i){return(0,Dt.jsx)(Lt.SVG,{ref:i,...t.props,...r,width:a,height:a})});var Q=o(v(),1),ve=o(n(),1),ke=(0,ve.jsx)(Q.SVG,{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",fill:"currentColor",children:(0,ve.jsx)(Q.Path,{d:"M17.7 4.3c-1.2 0-2.8 0-3.8 1-.6.6-.9 1.5-.9 2.6V14c-.6-.6-1.5-1-2.5-1C8.6 13 7 14.6 7 16.5S8.6 20 10.5 20c1.5 0 2.8-1 3.3-2.3.5-.8.7-1.8.7-2.5V7.9c0-.7.2-1.2.5-1.6.6-.6 1.8-.6 2.8-.6h.3V4.3h-.4z"})});var ee=o(v(),1),Ee=o(n(),1),Re=(0,Ee.jsx)(ee.SVG,{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",fill:"currentColor",children:(0,Ee.jsx)(ee.Path,{fillRule:"evenodd",clipRule:"evenodd",d:"M18 4H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM8.5 18.5H6c-.3 0-.5-.2-.5-.5V6c0-.3.2-.5.5-.5h2.5v13zm10-.5c0 .3-.2.5-.5.5h-8v-13h8c.3 0 .5.2.5.5v12z"})});var te=o(v(),1),ze=o(n(),1),Me=(0,ze.jsx)(te.SVG,{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",fill:"currentColor",children:(0,ze.jsx)(te.Path,{fillRule:"evenodd",clipRule:"evenodd",d:"M18 4H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-4 14.5H6c-.3 0-.5-.2-.5-.5V6c0-.3.2-.5.5-.5h8v13zm4.5-.5c0 .3-.2.5-.5.5h-2.5v-13H18c.3 0 .5.2.5.5v12z"})});var ae=o(v(),1),Se=o(n(),1),V=(0,Se.jsx)(ae.SVG,{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",fill:"currentColor",children:(0,Se.jsx)(ae.Path,{fillRule:"evenodd",clipRule:"evenodd",d:"M12.848 8a1 1 0 0 1-.914-.594l-.723-1.63a.5.5 0 0 0-.447-.276H5a.5.5 0 0 0-.5.5v11.5a.5.5 0 0 0 .5.5h14a.5.5 0 0 0 .5-.5v-9A.5.5 0 0 0 19 8h-6.152Zm.612-1.5a.5.5 0 0 1-.462-.31l-.445-1.084A2 2 0 0 0 10.763 4H5a2 2 0 0 0-2 2v11.5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-5.54Z"})});var oe=o(v(),1),Ce=o(n(),1),Te=(0,Ce.jsx)(oe.SVG,{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",fill:"currentColor",children:(0,Ce.jsx)(oe.Path,{d:"M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM5 4.5h14c.3 0 .5.2.5.5v8.4l-3-2.9c-.3-.3-.8-.3-1 0L11.9 14 9 12c-.3-.2-.6-.2-.8 0l-3.6 2.6V5c-.1-.3.1-.5.4-.5zm14 15H5c-.3 0-.5-.2-.5-.5v-2.4l4.1-3 3 1.9c.3.2.7.2.9-.1L16 12l3.5 3.4V19c0 .3-.2.5-.5.5z"})});var re=o(v(),1),Ie=o(n(),1),Ne=(0,Ie.jsx)(re.SVG,{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",fill:"currentColor",children:(0,Ie.jsx)(re.Path,{d:"M18.7 3H5.3C4 3 3 4 3 5.3v13.4C3 20 4 21 5.3 21h13.4c1.3 0 2.3-1 2.3-2.3V5.3C21 4 20 3 18.7 3zm.8 15.7c0 .4-.4.8-.8.8H5.3c-.4 0-.8-.4-.8-.8V5.3c0-.4.4-.8.8-.8h13.4c.4 0 .8.4.8.8v13.4zM10 15l5-3-5-3v6z"})});if(!document.head.querySelector("style[data-wp-hash='3bb11fea24']")){let e=document.createElement("style");e.setAttribute("data-wp-hash","3bb11fea24"),e.appendChild(document.createTextNode(`.zero-admin-media-editor-document-bar {
  background: #f0f0f0;
  border-radius: 4px;
  justify-content: space-between;
  align-items: center;
  width: min(100%, 450px);
  min-width: 0;
  height: 32px;
  display: flex;
}

.zero-admin-media-editor-document-bar:hover {
  background-color: #e0e0e0;
}

.zero-admin-media-editor-document-bar .components-button {
  border-radius: 4px;
}

@media not (prefers-reduced-motion) {
  .zero-admin-media-editor-document-bar .components-button {
    transition: all .1s ease-out;
  }
}

.zero-admin-media-editor-document-bar .components-button:hover {
  background: #e0e0e0;
}

.zero-admin-media-editor-document-bar__icon-layout {
  pointer-events: none;
  margin-left: 12px;
  display: none;
  position: absolute;
}

.zero-admin-media-editor-document-bar__icon-layout svg {
  fill: #949494;
}

@media screen and (width >= 600px) {
  .zero-admin-media-editor-document-bar__icon-layout {
    display: flex;
  }
}

.zero-admin-media-editor-document-bar__command {
  color: var(--wp-block-synced-color);
  flex-grow: 1;
  overflow: hidden;
}

.zero-admin-media-editor-document-bar__title {
  color: #1e1e1e;
  justify-content: center;
  align-items: center;
  max-width: 70%;
  margin: 0 auto;
  display: flex;
  overflow: hidden;
}

@media screen and (width >= 782px) {
  .zero-admin-media-editor-document-bar__title {
    padding-left: 24px;
  }
}

.zero-admin-media-editor-document-bar__title h1 {
  white-space: nowrap;
  justify-content: center;
  align-items: center;
  font-weight: 400;
  display: flex;
  overflow: hidden;
}

.zero-admin-media-editor-document-bar__post-title {
  color: currentColor;
  text-overflow: ellipsis;
  flex: 1;
  overflow: hidden;
}

.zero-admin-media-editor-document-bar__shortcut {
  color: #2f2f2f;
  min-width: 24px;
  display: none;
}

@media (width >= 782px) {
  .zero-admin-media-editor-document-bar__shortcut {
    display: initial;
  }
}
`)),document.head.appendChild(e)}var c=o(n());function Ae({icon:e,title:t}){let{open:a}=(0,Vt.useDispatch)(Ut.store),r=(0,Ot.useReducedMotion)(),i=(0,ie.useRef)(!1);return(0,ie.useEffect)(()=>{i.current=!0},[]),(0,c.jsxs)("div",{className:"zero-admin-media-editor-document-bar",children:[e&&(0,c.jsx)("span",{className:"zero-admin-media-editor-document-bar__icon-layout",children:(0,c.jsx)(B,{icon:e})}),(0,c.jsxs)(C.Button,{className:"zero-admin-media-editor-document-bar__command",onClick:()=>a(),size:"compact",children:[(0,c.jsx)(C.__unstableMotion.div,{className:"zero-admin-media-editor-document-bar__title",initial:i.current?{opacity:0,transform:"translateX(-15%)"}:!1,animate:{opacity:1,transform:"translateX(0%)"},transition:r?{duration:0}:void 0,children:(0,c.jsx)(C.__experimentalText,{size:"body",as:"h1",children:(0,c.jsx)("span",{className:"zero-admin-media-editor-document-bar__post-title",children:t?(0,Ht.__unstableStripHTML)(t):(0,Bt.__)("No title","zero-admin")})})}),(0,c.jsx)("span",{className:"zero-admin-media-editor-document-bar__shortcut",children:jt.displayShortcut.primary("k")})]})]})}var j=o(E());function de(e){return e.startsWith("image/")?{type:"image",label:(0,j.__)("Image","zero-admin"),icon:Te}:e.startsWith("video/")?{type:"video",label:(0,j.__)("Video","zero-admin"),icon:Ne}:e.startsWith("audio/")?{type:"audio",label:(0,j.__)("Audio","zero-admin"),icon:ke}:{type:"application",label:(0,j.__)("Application","zero-admin"),icon:V}}var _=o(n()),{PinnedItems:qa}=Fa(qt.privateApis);function Pe({backLink:e="/media"}){let t=(0,ne.useEntityId)("postType","attachment"),a=(0,$t.useViewportMatch)("medium","<"),r=(0,Ft.useSelect)(d=>d(ne.store).getEditedEntityRecord("postType","attachment",t),[t]);if(!r)return null;let i=de(r?.mime_type||"");return(0,_.jsxs)("div",{className:"zero-admin-media-details__header-container",children:[(0,_.jsx)("div",{className:"zero-admin-media-details__header-container-back-button",children:(0,_.jsx)(Ha,{to:e})}),(0,_.jsx)("div",{className:"zero-admin-media-details__header-container-center",children:!a&&(0,_.jsx)(Ae,{title:r?.title,icon:i.icon})}),(0,_.jsxs)("div",{className:"zero-admin-media-details__header-container-actions",children:[(0,_.jsx)(qa.Slot,{scope:"core/edit-media"}),(0,_.jsx)(xe,{postId:t})]})]})}var ca=o(R()),$=o(E());import{unlock as fo}from"@zero-admin/admin-toolkit";var _a=o(M());function $a(e,t){return function(r,...i){let d=new URL(e);return d.searchParams.set("code",r.toString()),i.forEach(s=>d.searchParams.append("args[]",s)),`${t} error #${r}; visit ${d} for the full message.`}}var Ga=$a("https://base-ui.com/production-error","Base UI"),Gt=Ga;var z=o(x(),1);var Yt=o(x(),1),Xt={};function Le(e,t){let a=Yt.useRef(Xt);return a.current===Xt&&(a.current=e(t)),a}function De(e,t,a,r){let i=Le(Zt).current;return Xa(i,e,t,a,r)&&Jt(i,[e,t,a,r]),i.callback}function Wt(e){let t=Le(Zt).current;return Ya(t,e)&&Jt(t,e),t.callback}function Zt(){return{callback:null,cleanup:null,refs:[]}}function Xa(e,t,a,r,i){return e.refs[0]!==t||e.refs[1]!==a||e.refs[2]!==r||e.refs[3]!==i}function Ya(e,t){return e.refs.length!==t.length||e.refs.some((a,r)=>a!==t[r])}function Jt(e,t){if(e.refs=t,t.every(a=>a==null)){e.callback=null;return}e.callback=a=>{if(e.cleanup&&(e.cleanup(),e.cleanup=null),a!=null){let r=Array(t.length).fill(null);for(let i=0;i<t.length;i+=1){let d=t[i];if(d!=null)switch(typeof d){case"function":{let s=d(a);typeof s=="function"&&(r[i]=s);break}case"object":{d.current=a;break}default:}}e.cleanup=()=>{for(let i=0;i<t.length;i+=1){let d=t[i];if(d!=null)switch(typeof d){case"function":{let s=r[i];typeof s=="function"?s():d(null);break}case"object":{d.current=null;break}default:}}}}}}var ea=o(x(),1);var Kt=o(x(),1),Wa=parseInt(Kt.version,10);function Qt(e){return Wa>=e}function Be(e){if(!ea.isValidElement(e))return null;let t=e,a=t.props;return(Qt(19)?a?.ref:t.ref)??null}function U(e,t){if(e&&!t)return e;if(!e&&t)return t;if(e||t)return{...e,...t}}var vr=Object.freeze([]),T=Object.freeze({});function ta(e,t){let a={};for(let r in e){let i=e[r];if(t?.hasOwnProperty(r)){let d=t[r](i);d!=null&&Object.assign(a,d);continue}i===!0?a[`data-${r.toLowerCase()}`]="":i&&(a[`data-${r.toLowerCase()}`]=i.toString())}return a}function aa(e,t){return typeof e=="function"?e(t):e}function oa(e,t){return typeof e=="function"?e(t):e}var Ve={};function H(e,t,a,r,i){if(!a&&!r&&!i&&!e)return se(t);let d=se(e);return t&&(d=O(d,t)),a&&(d=O(d,a)),r&&(d=O(d,r)),i&&(d=O(d,i)),d}function ra(e){if(e.length===0)return Ve;if(e.length===1)return se(e[0]);let t=se(e[0]);for(let a=1;a<e.length;a+=1)t=O(t,e[a]);return t}function se(e){return je(e)?{...da(e,Ve)}:Za(e)}function O(e,t){return je(t)?da(t,e):Ja(e,t)}function Za(e){let t={...e};for(let a in t){let r=t[a];ia(a,r)&&(t[a]=na(r))}return t}function Ja(e,t){if(!t)return e;for(let a in t){let r=t[a];switch(a){case"style":{e[a]=U(e.style,r);break}case"className":{e[a]=Ue(e.className,r);break}default:ia(a,r)?e[a]=Ka(e[a],r):e[a]=r}}return e}function ia(e,t){let a=e.charCodeAt(0),r=e.charCodeAt(1),i=e.charCodeAt(2);return a===111&&r===110&&i>=65&&i<=90&&(typeof t=="function"||typeof t>"u")}function je(e){return typeof e=="function"}function da(e,t){return je(e)?e(t):e??Ve}function Ka(e,t){return t?e?(...a)=>{let r=a[0];if(la(r)){let d=r;sa(d);let s=t(...a);return d.baseUIHandlerPrevented||e?.(...a),s}let i=t(...a);return e?.(...a),i}:na(t):e}function na(e){return e&&((...t)=>{let a=t[0];return la(a)&&sa(a),e(...t)})}function sa(e){return e.preventBaseUIHandler=()=>{e.baseUIHandlerPrevented=!0},e}function Ue(e,t){return t?e?t+" "+e:t:e}function la(e){return e!=null&&typeof e=="object"&&"nativeEvent"in e}var Oe=o(x(),1);function fa(e,t,a={}){let r=t.render,i=Qa(t,a);if(a.enabled===!1)return null;let d=a.state??T;return ao(e,r,i,d)}function Qa(e,t={}){let{className:a,style:r,render:i}=e,{state:d=T,ref:s,props:m,stateAttributesMapping:p,enabled:l=!0}=t,y=l?aa(a,d):void 0,k=l?oa(r,d):void 0,L=l?ta(d,p):T,ce=l&&m?eo(m):void 0,u=l?U(L,ce)??{}:T;return typeof document<"u"&&(l?Array.isArray(s)?u.ref=Wt([u.ref,Be(i),...s]):u.ref=De(u.ref,Be(i),s):De(null,null)),l?(y!==void 0&&(u.className=Ue(u.className,y)),k!==void 0&&(u.style=U(u.style,k)),u):T}function eo(e){return Array.isArray(e)?ra(e):H(void 0,e)}var to=Symbol.for("react.lazy");function ao(e,t,a,r){if(t){if(typeof t=="function")return t(a,r);let i=H(a,t.props);i.ref=a.ref;let d=t;return d?.$$typeof===to&&(d=z.Children.toArray(t)[0]),z.cloneElement(d,i)}if(e&&typeof e=="string")return oo(e,a);throw new Error(Gt(8))}function oo(e,t){return e==="button"?(0,Oe.createElement)("button",{type:"button",...t,key:t.key}):e==="img"?(0,Oe.createElement)("img",{alt:"",...t,key:t.key}):z.createElement(e,t)}function ma(e){return fa(e.defaultTagName??"div",e,e)}var ua=o(x(),1);if(!document.head.querySelector("style[data-wp-hash='8e2bea0d2d']")){let e=document.createElement("style");e.setAttribute("data-wp-hash","8e2bea0d2d"),e.appendChild(document.createTextNode(`@layer wp-ui-utilities;

@layer wp-ui-components {
  ._1m5Xoa-stack {
    gap: var(--wp-ui-stack-gap);
    align-items: var(--wp-ui-stack-align);
    justify-content: var(--wp-ui-stack-justify);
    display: flex;

    &._1m5Xoa-is-direction-column {
      flex-direction: column;
    }

    &._1m5Xoa-is-wrap {
      flex-wrap: wrap;
    }
  }
}

@layer wp-ui-compositions, wp-ui-overrides;
`)),document.head.appendChild(e)}var le={"is-direction-column":"_1m5Xoa-is-direction-column","is-wrap":"_1m5Xoa-is-wrap",stack:"_1m5Xoa-stack"};var ro=e=>typeof e=="number"?`calc( ${e} * var( --wpds-dimension-base ) )`:e,F=(0,ua.forwardRef)(function({direction:t,gap:a="initial",align:r="initial",justify:i="initial",wrap:d,render:s,...m},p){let l=K(le.stack,le[`is-direction-${t}`],le[`is-${d}`]),y={"--wp-ui-stack-gap":ro(a),"--wp-ui-stack-align":r,"--wp-ui-stack-justify":i};return ma({render:s,ref:p,props:H({style:y,className:l},m)})});var fe=o(w()),pa=o(M()),q=o(b()),g=o(n());import{usePostFields as io}from"@zero-admin/fields-next";import{unlock as no}from"@zero-admin/admin-toolkit";import{DataForm as so}from"@zero-admin/dataviews";var{PostCardPanel:lo}=no(pa.privateApis);function He(){let e=(0,q.useEntityId)("postType","attachment"),{post:t,editedPost:a,postTypeObject:r}=(0,fe.useSelect)(p=>{let{getEntityRecord:l,getEditedEntityRecord:y,getPostType:k}=p(q.store);return{post:l("postType","attachment",e,{_embed:"wp:attached-to"}),editedPost:y("postType","attachment",e),postTypeObject:k("attachment")}},[e]),{fields:i}=io({postType:"attachment"}),d=r?.quick_edit_form,{editEntityRecord:s}=(0,fe.useDispatch)(q.store),m=p=>{s("postType","attachment",e,p)};return t?(0,g.jsx)("div",{className:"zero-admin-media-editor-sidebar__details",children:(0,g.jsx)(F,{direction:"column",gap:4,children:a&&(0,g.jsxs)(g.Fragment,{children:[(0,g.jsx)(lo,{postType:t?.type,postId:e}),!!d&&i.length>0&&(0,g.jsx)(so,{data:a,fields:i,form:d,onChange:m})]})})}):null}if(!document.head.querySelector("style[data-wp-hash='0d2a7b8437']")){let e=document.createElement("style");e.setAttribute("data-wp-hash","0d2a7b8437"),e.appendChild(document.createTextNode(`.zero-admin-media-editor-sidebar__details {
  flex-direction: column;
  flex-grow: 1;
  height: 100%;
  display: flex;
  overflow: auto;
}

.zero-admin-media-editor-sidebar__tabs-header {
  padding-left: 0;
  padding-right: 8px;
}

.zero-admin-media-editor-sidebar__tabs-header-text {
  margin-left: 4px;
}

.zero-admin-media-editor-sidebar .dataforms-layouts-panel__field-control .components-button.is-tertiary[aria-disabled="true"] {
  color: unset;
  background: none;
}

.zero-admin-media-editor-sidebar__details {
  padding: 16px;
}

@media (width <= 782px) {
  .zero-admin-media-editor-sidebar {
    width: auto;
  }
}
`)),document.head.appendChild(e)}var me=o(n()),mo="core/edit-media",uo="core/edit-media/details",po=ca.Platform.select({web:!0}),{ComplementaryArea:co}=fo(_a.privateApis);function Fe(){return(0,me.jsx)(co,{className:"zero-admin-media-editor-sidebar",title:(0,$.__)("Details","zero-admin"),closeLabel:(0,$.__)("Close details","zero-admin"),scope:mo,identifier:uo,icon:(0,$.isRTL)()?Re:Me,isActiveByDefault:po,children:(0,me.jsx)("div",{className:"zero-admin-media-editor-sidebar__tabs-panel",children:(0,me.jsx)(He,{})})})}var xa=o(w()),ue=o(b());var ba=o(R());var ha=o(n());function qe(){return(0,ha.jsx)(B,{icon:V,size:128})}var N=o(S(),1);if(!document.head.querySelector("style[data-wp-hash='fd022c9450']")){let e=document.createElement("style");e.setAttribute("data-wp-hash","fd022c9450"),e.appendChild(document.createTextNode(`.zero-admin-media-loading {
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
  display: flex;
}

.zero-admin-media-loading .components-spinner {
  margin: 0;
}
`)),document.head.appendChild(e)}var I=o(n(),1);function A({resource:e}){return e.kind==="error"?(0,I.jsxs)(N.Notice,{status:"error",isDismissible:!1,children:[e.message," ",(0,I.jsx)(N.Button,{variant:"secondary",onClick:e.retry,children:"Retry media"})]}):(0,I.jsx)("div",{className:"zero-admin-media-loading",children:(0,I.jsx)(N.Spinner,{})})}var ya=o(x(),1);function P(e,t,a){let r=(0,ya.useCallback)(()=>{},[]);return{kind:"ready",url:t,retry:r}}var $e=o(n());function Ge({post:e}){let t=P(e?.id,e?.source_url,e?.modified),a=t.kind==="ready"?t.url:void 0;return t.kind!=="ready"?(0,$e.jsx)(A,{resource:t}):e?(0,$e.jsx)("audio",{controls:!0,src:a,autoPlay:!1,preload:"true"}):null}var ga=o(n());function Xe({sourceUrl:e,altText:t}){return(0,ga.jsx)("img",{className:"zero-admin-media-editor-content__image",src:e,alt:t})}var Ye=o(n());function We({post:e}){let t=P(e?.id,e?.source_url,e?.modified),a=t.kind==="ready"?t.url:void 0;return t.kind!=="ready"?(0,Ye.jsx)(A,{resource:t}):e?(0,Ye.jsx)(Xe,{sourceUrl:a??"",altText:e.alt_text}):null}var Ze=o(n());function Je({post:e}){let t=P(e?.id,e?.source_url,e?.modified),a=t.kind==="ready"?t.url:void 0;return t.kind!=="ready"?(0,Ze.jsx)(A,{resource:t}):e?(0,Ze.jsx)("video",{className:"zero-admin-media-editor-content__video",controls:!0,preload:"true",src:a}):null}if(!document.head.querySelector("style[data-wp-hash='eceffafdfe']")){let e=document.createElement("style");e.setAttribute("data-wp-hash","eceffafdfe"),e.appendChild(document.createTextNode(`.zero-admin-media-editor-content__image, .zero-admin-media-editor-content__video {
  object-fit: contain;
  width: auto;
  max-width: 100%;
  height: auto;
  max-height: 100%;
  transition: opacity .2s ease-in-out;
}
`)),document.head.appendChild(e)}var wa=o(n()),_o={application:qe,audio:Ge,image:We,video:Je};function Ke({post:e}){let t=(0,ba.useMemo)(()=>de(e.mime_type||""),[e.mime_type]),a=_o[t.type];return a?(0,wa.jsx)(a,{post:e}):null}var Qe=o(n());function et(){let e=(0,ue.useEntityId)("postType","attachment"),t=(0,xa.useSelect)(a=>a(ue.store).getEntityRecord("postType","attachment",e,{_embed:"author,wp:attached-to"}),[e]);return t?(0,Qe.jsx)(F,{className:K("zero-admin-media-details__content-container"),direction:"column",justify:"center",align:"center",gap:2,children:(0,Qe.jsx)(Ke,{post:t})}):null}if(!document.head.querySelector("style[data-wp-hash='da93859de0']")){let e=document.createElement("style");e.setAttribute("data-wp-hash","da93859de0"),e.appendChild(document.createTextNode(`.zero-admin-site-editor__media-editor-layout {
  background-color: var(--wpds-color-bg-surface-neutral-strong);
}

.zero-admin-site-editor__media-editor-layout .zero-admin-site-editor__hyperlink {
  pointer-events: all;
  cursor: default;
}

.zero-admin-site-editor__media-editor-layout .zero-admin-media-editor__toolbar {
  z-index: 1;
  background: #fff;
  justify-content: center;
  align-items: center;
  position: relative;
}

.zero-admin-site-editor__media-editor-layout .interface-pinned-items .components-button[aria-controls="core:edit-media/details"] {
  display: flex;
}

.zero-admin-media-details__header-container {
  background: var(--wpds-color-bg-surface-neutral-strong);
  grid-template: auto / 64px minmax(min-content, 2fr) 2.5fr minmax(min-content, 2fr) 64px;
  grid-auto-flow: row;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  max-width: 100vw;
  height: 64px;
  display: grid;
}

.zero-admin-media-details__header-container .zero-admin-media-details__header-container-toolbar {
  grid-column: 2 / 3;
  align-items: center;
  min-width: 0;
  display: flex;
}

.zero-admin-media-details__header-container .zero-admin-media-details__header-container-center {
  clip-path: inset(-2px);
  grid-column: 3 / 4;
  justify-content: center;
  align-items: center;
  min-width: 0;
  display: flex;
}

@media (width <= 479px) {
  .zero-admin-media-details__header-container .zero-admin-media-details__header-container-center > :first-child {
    margin-inline-start: 8px;
  }

  .zero-admin-media-details__header-container .zero-admin-media-details__header-container-center > :last-child {
    margin-inline-end: 8px;
  }
}

.zero-admin-media-details__header-container .zero-admin-media-details__header-container-actions {
  flex-wrap: nowrap;
  grid-column: 4 / -1;
  justify-self: end;
  align-items: center;
  gap: 8px;
  padding-right: 16px;
  display: inline-flex;
}

.zero-admin-media-details__header-container .zero-admin-media-details__header-container-actions [aria-controls="media-settings"] {
  display: flex;
}

.zero-admin-media-details__content-container {
  box-sizing: border-box;
  height: 100%;
  max-height: 100%;
  color: var(--wpds-color-fg-content-neutral);
  padding: 16px;
}
`)),document.head.appendChild(e)}var h=o(n()),{InterfaceSkeleton:go,ComplementaryArea:bo}=ho(va.privateApis);function tt({isPreview:e,editLink:t}){let a=yo({to:t,className:"zero-admin-site-editor__hyperlink"});return(0,h.jsxs)("div",{className:"zero-admin-site-editor zero-admin-site-editor__media-editor-layout",children:[(0,h.jsx)(go,{header:!e&&(0,h.jsx)(Pe,{backLink:t.startsWith("/collections/")?t.slice(0,t.lastIndexOf("/")):void 0}),sidebar:!e&&(0,h.jsx)(bo.Slot,{scope:"core/edit-media"}),content:(0,h.jsx)(et,{}),secondarySidebar:null}),e&&(0,h.jsx)("a",{...a,"aria-label":(0,ka.__)("Edit","zero-admin")}),(0,h.jsx)(be,{}),(0,h.jsx)(Fe,{})]})}var G=o(n());function pe({postType:e="attachment",postId:t,children:a,isPreview:r=!1,editLink:i}){let{record:d,isResolving:s}=(0,Ea.useEntityRecord)("postType",e,t);if(!s&&!d)return(0,G.jsx)(Ra.Notice,{status:"error",isDismissible:!1,children:(0,za.__)("You attempted to edit an item that doesn't exist. Perhaps it was deleted?","zero-admin")});let m=i??`/media/${t}`;return(0,G.jsxs)(yt,{post:d,children:[(0,G.jsx)(tt,{isPreview:r,editLink:m}),a]})}var Zi={canvas:async({params:e})=>{let{unregisterEntityAction:t}=Sa((0,X.dispatch)(at.store));return await t("postType","attachment","duplicate-post"),await t("postType","attachment","move-to-trash"),{postType:"attachment",postId:e.id,component:pe}},loader:async()=>{await wo("postType","attachment")},beforeLoad:async()=>{try{if(!(await(0,X.resolveSelect)(Ca.store).getPostType("attachment"))?.visibility?.show_ui)throw Ma();let{registerPostTypeSchema:t}=Sa((0,X.dispatch)(at.store));await t("attachment")}catch{throw Ma()}}};export{Zi as route};
