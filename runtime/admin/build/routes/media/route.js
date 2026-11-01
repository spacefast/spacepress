import '__i18n__';
var Aa=Object.create;var nt=Object.defineProperty;var Na=Object.getOwnPropertyDescriptor;var La=Object.getOwnPropertyNames;var Va=Object.getPrototypeOf,Da=Object.prototype.hasOwnProperty;var f=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports);var Ba=(e,t,a,r)=>{if(t&&typeof t=="object"||typeof t=="function")for(let i of La(t))!Da.call(e,i)&&i!==a&&nt(e,i,{get:()=>t[i],enumerable:!(r=Na(t,i))||r.enumerable});return e};var o=(e,t,a)=>(a=e!=null?Aa(Va(e)):{},Ba(t||!e||!e.__esModule?nt(a,"default",{value:e,enumerable:!0}):a,e));var b=f((Mo,dt)=>{"use strict";dt.exports=window.wp.data});var v=f((So,st)=>{"use strict";st.exports=window.wp.coreData});var T=f((To,lt)=>{"use strict";lt.exports=window.wp.components});var z=f((Co,ft)=>{"use strict";ft.exports=window.wp.i18n});var M=f((Io,mt)=>{"use strict";mt.exports=window.wp.element});var Y=f((Po,ut)=>{"use strict";ut.exports=window.wp.compose});var d=f((Ao,pt)=>{"use strict";pt.exports=window.ReactJSXRuntime});var D=f((Do,wt)=>{"use strict";wt.exports=window.wp.editor});var we=f((Bo,bt)=>{"use strict";bt.exports=window.wp.notices});var Mt=f((Oo,zt)=>{"use strict";zt.exports=window.wp.keycodes});var Tt=f((Ho,St)=>{"use strict";St.exports=window.wp.commands});var It=f((Fo,Ct)=>{"use strict";Ct.exports=window.wp.dom});var k=f(($o,At)=>{"use strict";At.exports=window.React});var R=f((Go,Nt)=>{"use strict";Nt.exports=window.wp.primitives});var g=o(b()),y=o(v());import{notFound as Ca}from"@wordpress/route";import{viewToQuery as Ia}from"@zero-admin/admin-toolkit";import{preloadFieldCollections as Eo}from"@zero-admin/core-data-next";if(!document.head.querySelector("style[data-wp-hash='7af6180997']")){let e=document.createElement("style");e.setAttribute("data-wp-hash","7af6180997"),e.appendChild(document.createTextNode(`:root {
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
`)),document.head.appendChild(e)}var Ea=o(v()),za=o(T()),Ma=o(z());var ht=o(v());var ye=o(M()),ct=o(Y()),ge=o(d()),ja=(0,ye.createContext)({}),Ua=(0,ct.createHigherOrderComponent)(e=>{let t=({...a})=>(0,ge.jsx)(ja.Provider,{value:{},children:(0,ge.jsx)(e,{...a})});return t.displayName=`withMediaEditorStateProvider(${e.displayName||e.name||"Component"})`,t},"withMediaEditorStateProvider"),_t=Ua;var yt=o(d()),Oa=_t(({post:e,children:t})=>e?(0,yt.jsx)(ht.EntityProvider,{kind:"postType",type:"attachment",id:e.id,children:t}):null),gt=Oa;var ka=o(D()),Ra=o(z());import{unlock as yo}from"@zero-admin/admin-toolkit";import{useLinkProps as wo}from"@wordpress/route";var vt=o(T()),Z=o(b()),be=o(we()),xt=o(d()),Ha=-3;function ve(){let e=(0,Z.useSelect)(r=>r(be.store).getNotices(),[]),{removeNotice:t}=(0,Z.useDispatch)(be.store),a=e.filter(({type:r})=>r==="snackbar").slice(Ha);return(0,xt.jsx)(vt.SnackbarList,{notices:a,className:"components-editor-notices__snackbar",onRemove:t})}var qt=o(b()),$t=o(D()),se=o(v()),Gt=o(Y());import{SiteIconBackButton as qa,unlock as $a}from"@zero-admin/admin-toolkit";var J=o(z()),kt=o(T()),xe=o(v()),B=o(b()),Rt=o(we()),Q=o(M()),Et=o(d());function ke({postId:e}){let{post:t,isDisabled:a,isEntityRecordDirty:r,isSaving:i}=(0,B.useSelect)(V=>{let{hasEditsForEntityRecord:he,isSavingEntityRecord:u,getEditedEntityRecord:Pa}=V(xe.store),rt=he("postType","attachment",e),it=u("postType","attachment",e);return{isEntityRecordDirty:rt,isSaving:it,isDisabled:it||!rt,post:Pa("postType","attachment",e)}},[e]),{createSuccessNotice:n,createErrorNotice:s}=(0,B.useDispatch)(Rt.store),{invalidateResolution:m,saveEditedEntityRecord:p}=(0,B.useDispatch)(xe.store),l=(0,Q.useCallback)(()=>{m("getEntityRecord",["postType","attachment",e,{_embed:"wp:attached-to"}])},[m,e]),w=(0,Q.useCallback)(async()=>{try{return await p("postType","attachment",e,{throwOnError:!0,isCached:!1})}catch{s((0,J.__)("Could not save attachment.","zero-admin"),{id:"attachment-save-error",type:"snackbar"})}},[p,e,s]),E=(0,Q.useCallback)(async()=>{!r||!await w()||(n((0,J.__)("Media saved","zero-admin"),{id:"attachments-save-success",type:"snackbar"}),l())},[w,r,n,l]);return(0,Et.jsx)(kt.Button,{variant:"primary",size:"compact",onClick:E,isBusy:i,disabled:a,accessibleWhenDisabled:!0,children:(0,J.__)("Save","zero-admin")})}var Bt=o(z()),jt=o(b()),C=o(T()),Ut=o(Mt()),Ot=o(Tt()),ne=o(M()),Ht=o(Y()),Ft=o(It());function Pt(e){var t,a,r="";if(typeof e=="string"||typeof e=="number")r+=e;else if(typeof e=="object")if(Array.isArray(e)){var i=e.length;for(t=0;t<i;t++)e[t]&&(a=Pt(e[t]))&&(r&&(r+=" "),r+=a)}else for(a in e)e[a]&&(r&&(r+=" "),r+=a);return r}function Fa(){for(var e,t,a=0,r="",i=arguments.length;a<i;a++)(e=arguments[a])&&(t=Pt(e))&&(r&&(r+=" "),r+=t);return r}var K=Fa;var Lt=o(M(),1),Vt=o(R(),1),Dt=o(d(),1),j=(0,Lt.forwardRef)(function({icon:t,size:a=24,...r},i){return(0,Dt.jsx)(Vt.SVG,{ref:i,...t.props,...r,width:a,height:a})});var ee=o(R(),1),Re=o(d(),1),Ee=(0,Re.jsx)(ee.SVG,{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",fill:"currentColor",children:(0,Re.jsx)(ee.Path,{d:"M17.7 4.3c-1.2 0-2.8 0-3.8 1-.6.6-.9 1.5-.9 2.6V14c-.6-.6-1.5-1-2.5-1C8.6 13 7 14.6 7 16.5S8.6 20 10.5 20c1.5 0 2.8-1 3.3-2.3.5-.8.7-1.8.7-2.5V7.9c0-.7.2-1.2.5-1.6.6-.6 1.8-.6 2.8-.6h.3V4.3h-.4z"})});var te=o(R(),1),ze=o(d(),1),Me=(0,ze.jsx)(te.SVG,{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",fill:"currentColor",children:(0,ze.jsx)(te.Path,{fillRule:"evenodd",clipRule:"evenodd",d:"M18 4H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM8.5 18.5H6c-.3 0-.5-.2-.5-.5V6c0-.3.2-.5.5-.5h2.5v13zm10-.5c0 .3-.2.5-.5.5h-8v-13h8c.3 0 .5.2.5.5v12z"})});var ae=o(R(),1),Se=o(d(),1),Te=(0,Se.jsx)(ae.SVG,{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",fill:"currentColor",children:(0,Se.jsx)(ae.Path,{fillRule:"evenodd",clipRule:"evenodd",d:"M18 4H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-4 14.5H6c-.3 0-.5-.2-.5-.5V6c0-.3.2-.5.5-.5h8v13zm4.5-.5c0 .3-.2.5-.5.5h-2.5v-13H18c.3 0 .5.2.5.5v12z"})});var oe=o(R(),1),Ce=o(d(),1),U=(0,Ce.jsx)(oe.SVG,{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",fill:"currentColor",children:(0,Ce.jsx)(oe.Path,{fillRule:"evenodd",clipRule:"evenodd",d:"M12.848 8a1 1 0 0 1-.914-.594l-.723-1.63a.5.5 0 0 0-.447-.276H5a.5.5 0 0 0-.5.5v11.5a.5.5 0 0 0 .5.5h14a.5.5 0 0 0 .5-.5v-9A.5.5 0 0 0 19 8h-6.152Zm.612-1.5a.5.5 0 0 1-.462-.31l-.445-1.084A2 2 0 0 0 10.763 4H5a2 2 0 0 0-2 2v11.5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-5.54Z"})});var re=o(R(),1),Ie=o(d(),1),Pe=(0,Ie.jsx)(re.SVG,{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",fill:"currentColor",children:(0,Ie.jsx)(re.Path,{d:"M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM5 4.5h14c.3 0 .5.2.5.5v8.4l-3-2.9c-.3-.3-.8-.3-1 0L11.9 14 9 12c-.3-.2-.6-.2-.8 0l-3.6 2.6V5c-.1-.3.1-.5.4-.5zm14 15H5c-.3 0-.5-.2-.5-.5v-2.4l4.1-3 3 1.9c.3.2.7.2.9-.1L16 12l3.5 3.4V19c0 .3-.2.5-.5.5z"})});var ie=o(R(),1),Ae=o(d(),1),Ne=(0,Ae.jsx)(ie.SVG,{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",fill:"currentColor",children:(0,Ae.jsx)(ie.Path,{d:"M18.7 3H5.3C4 3 3 4 3 5.3v13.4C3 20 4 21 5.3 21h13.4c1.3 0 2.3-1 2.3-2.3V5.3C21 4 20 3 18.7 3zm.8 15.7c0 .4-.4.8-.8.8H5.3c-.4 0-.8-.4-.8-.8V5.3c0-.4.4-.8.8-.8h13.4c.4 0 .8.4.8.8v13.4zM10 15l5-3-5-3v6z"})});if(!document.head.querySelector("style[data-wp-hash='3bb11fea24']")){let e=document.createElement("style");e.setAttribute("data-wp-hash","3bb11fea24"),e.appendChild(document.createTextNode(`.zero-admin-media-editor-document-bar {
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
`)),document.head.appendChild(e)}var c=o(d());function Le({icon:e,title:t}){let{open:a}=(0,jt.useDispatch)(Ot.store),r=(0,Ht.useReducedMotion)(),i=(0,ne.useRef)(!1);return(0,ne.useEffect)(()=>{i.current=!0},[]),(0,c.jsxs)("div",{className:"zero-admin-media-editor-document-bar",children:[e&&(0,c.jsx)("span",{className:"zero-admin-media-editor-document-bar__icon-layout",children:(0,c.jsx)(j,{icon:e})}),(0,c.jsxs)(C.Button,{className:"zero-admin-media-editor-document-bar__command",onClick:()=>a(),size:"compact",children:[(0,c.jsx)(C.__unstableMotion.div,{className:"zero-admin-media-editor-document-bar__title",initial:i.current?{opacity:0,transform:"translateX(-15%)"}:!1,animate:{opacity:1,transform:"translateX(0%)"},transition:r?{duration:0}:void 0,children:(0,c.jsx)(C.__experimentalText,{size:"body",as:"h1",children:(0,c.jsx)("span",{className:"zero-admin-media-editor-document-bar__post-title",children:t?(0,Ft.__unstableStripHTML)(t):(0,Bt.__)("No title","zero-admin")})})}),(0,c.jsx)("span",{className:"zero-admin-media-editor-document-bar__shortcut",children:Ut.displayShortcut.primary("k")})]})]})}var O=o(z());function de(e){return e.startsWith("image/")?{type:"image",label:(0,O.__)("Image","zero-admin"),icon:Pe}:e.startsWith("video/")?{type:"video",label:(0,O.__)("Video","zero-admin"),icon:Ne}:e.startsWith("audio/")?{type:"audio",label:(0,O.__)("Audio","zero-admin"),icon:Ee}:{type:"application",label:(0,O.__)("Application","zero-admin"),icon:U}}var _=o(d()),{PinnedItems:Ga}=$a($t.privateApis);function Ve({backLink:e="/media"}){let t=(0,se.useEntityId)("postType","attachment"),a=(0,Gt.useViewportMatch)("medium","<"),r=(0,qt.useSelect)(n=>n(se.store).getEditedEntityRecord("postType","attachment",t),[t]);if(!r)return null;let i=de(r?.mime_type||"");return(0,_.jsxs)("div",{className:"zero-admin-media-details__header-container",children:[(0,_.jsx)("div",{className:"zero-admin-media-details__header-container-back-button",children:(0,_.jsx)(qa,{to:e})}),(0,_.jsx)("div",{className:"zero-admin-media-details__header-container-center",children:!a&&(0,_.jsx)(Le,{title:r?.title,icon:i.icon})}),(0,_.jsxs)("div",{className:"zero-admin-media-details__header-container-actions",children:[(0,_.jsx)(Ga.Slot,{scope:"core/edit-media"}),(0,_.jsx)(ke,{postId:t})]})]})}var _a=o(M()),W=o(z());import{unlock as uo}from"@zero-admin/admin-toolkit";var ha=o(D());function Wa(e,t){return function(r,...i){let n=new URL(e);return n.searchParams.set("code",r.toString()),i.forEach(s=>n.searchParams.append("args[]",s)),`${t} error #${r}; visit ${n} for the full message.`}}var Xa=Wa("https://base-ui.com/production-error","Base UI"),Wt=Xa;var S=o(k(),1);var Yt=o(k(),1),Xt={};function De(e,t){let a=Yt.useRef(Xt);return a.current===Xt&&(a.current=e(t)),a}function Be(e,t,a,r){let i=De(Jt).current;return Ya(i,e,t,a,r)&&Qt(i,[e,t,a,r]),i.callback}function Zt(e){let t=De(Jt).current;return Za(t,e)&&Qt(t,e),t.callback}function Jt(){return{callback:null,cleanup:null,refs:[]}}function Ya(e,t,a,r,i){return e.refs[0]!==t||e.refs[1]!==a||e.refs[2]!==r||e.refs[3]!==i}function Za(e,t){return e.refs.length!==t.length||e.refs.some((a,r)=>a!==t[r])}function Qt(e,t){if(e.refs=t,t.every(a=>a==null)){e.callback=null;return}e.callback=a=>{if(e.cleanup&&(e.cleanup(),e.cleanup=null),a!=null){let r=Array(t.length).fill(null);for(let i=0;i<t.length;i+=1){let n=t[i];if(n!=null)switch(typeof n){case"function":{let s=n(a);typeof s=="function"&&(r[i]=s);break}case"object":{n.current=a;break}default:}}e.cleanup=()=>{for(let i=0;i<t.length;i+=1){let n=t[i];if(n!=null)switch(typeof n){case"function":{let s=r[i];typeof s=="function"?s():n(null);break}case"object":{n.current=null;break}default:}}}}}}var ta=o(k(),1);var Kt=o(k(),1),Ja=parseInt(Kt.version,10);function ea(e){return Ja>=e}function je(e){if(!ta.isValidElement(e))return null;let t=e,a=t.props;return(ea(19)?a?.ref:t.ref)??null}function H(e,t){if(e&&!t)return e;if(!e&&t)return t;if(e||t)return{...e,...t}}var Mr=Object.freeze([]),I=Object.freeze({});function aa(e,t){let a={};for(let r in e){let i=e[r];if(t?.hasOwnProperty(r)){let n=t[r](i);n!=null&&Object.assign(a,n);continue}i===!0?a[`data-${r.toLowerCase()}`]="":i&&(a[`data-${r.toLowerCase()}`]=i.toString())}return a}function oa(e,t){return typeof e=="function"?e(t):e}function ra(e,t){return typeof e=="function"?e(t):e}var Ue={};function q(e,t,a,r,i){if(!a&&!r&&!i&&!e)return le(t);let n=le(e);return t&&(n=F(n,t)),a&&(n=F(n,a)),r&&(n=F(n,r)),i&&(n=F(n,i)),n}function ia(e){if(e.length===0)return Ue;if(e.length===1)return le(e[0]);let t=le(e[0]);for(let a=1;a<e.length;a+=1)t=F(t,e[a]);return t}function le(e){return Oe(e)?{...da(e,Ue)}:Qa(e)}function F(e,t){return Oe(t)?da(t,e):Ka(e,t)}function Qa(e){let t={...e};for(let a in t){let r=t[a];na(a,r)&&(t[a]=sa(r))}return t}function Ka(e,t){if(!t)return e;for(let a in t){let r=t[a];switch(a){case"style":{e[a]=H(e.style,r);break}case"className":{e[a]=He(e.className,r);break}default:na(a,r)?e[a]=eo(e[a],r):e[a]=r}}return e}function na(e,t){let a=e.charCodeAt(0),r=e.charCodeAt(1),i=e.charCodeAt(2);return a===111&&r===110&&i>=65&&i<=90&&(typeof t=="function"||typeof t>"u")}function Oe(e){return typeof e=="function"}function da(e,t){return Oe(e)?e(t):e??Ue}function eo(e,t){return t?e?(...a)=>{let r=a[0];if(fa(r)){let n=r;la(n);let s=t(...a);return n.baseUIHandlerPrevented||e?.(...a),s}let i=t(...a);return e?.(...a),i}:sa(t):e}function sa(e){return e&&((...t)=>{let a=t[0];return fa(a)&&la(a),e(...t)})}function la(e){return e.preventBaseUIHandler=()=>{e.baseUIHandlerPrevented=!0},e}function He(e,t){return t?e?t+" "+e:t:e}function fa(e){return e!=null&&typeof e=="object"&&"nativeEvent"in e}var Fe=o(k(),1);function ma(e,t,a={}){let r=t.render,i=to(t,a);if(a.enabled===!1)return null;let n=a.state??I;return ro(e,r,i,n)}function to(e,t={}){let{className:a,style:r,render:i}=e,{state:n=I,ref:s,props:m,stateAttributesMapping:p,enabled:l=!0}=t,w=l?oa(a,n):void 0,E=l?ra(r,n):void 0,V=l?aa(n,p):I,he=l&&m?ao(m):void 0,u=l?H(V,he)??{}:I;return typeof document<"u"&&(l?Array.isArray(s)?u.ref=Zt([u.ref,je(i),...s]):u.ref=Be(u.ref,je(i),s):Be(null,null)),l?(w!==void 0&&(u.className=He(u.className,w)),E!==void 0&&(u.style=H(u.style,E)),u):I}function ao(e){return Array.isArray(e)?ia(e):q(void 0,e)}var oo=Symbol.for("react.lazy");function ro(e,t,a,r){if(t){if(typeof t=="function")return t(a,r);let i=q(a,t.props);i.ref=a.ref;let n=t;return n?.$$typeof===oo&&(n=S.Children.toArray(t)[0]),S.cloneElement(n,i)}if(e&&typeof e=="string")return io(e,a);throw new Error(Wt(8))}function io(e,t){return e==="button"?(0,Fe.createElement)("button",{type:"button",...t,key:t.key}):e==="img"?(0,Fe.createElement)("img",{alt:"",...t,key:t.key}):S.createElement(e,t)}function ua(e){return ma(e.defaultTagName??"div",e,e)}var pa=o(k(),1);if(!document.head.querySelector("style[data-wp-hash='8e2bea0d2d']")){let e=document.createElement("style");e.setAttribute("data-wp-hash","8e2bea0d2d"),e.appendChild(document.createTextNode(`@layer wp-ui-utilities;

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
`)),document.head.appendChild(e)}var fe={"is-direction-column":"_1m5Xoa-is-direction-column","is-wrap":"_1m5Xoa-is-wrap",stack:"_1m5Xoa-stack"};var no=e=>typeof e=="number"?`calc( ${e} * var( --wpds-dimension-base ) )`:e,$=(0,pa.forwardRef)(function({direction:t,gap:a="initial",align:r="initial",justify:i="initial",wrap:n,render:s,...m},p){let l=K(fe.stack,fe[`is-direction-${t}`],fe[`is-${n}`]),w={"--wp-ui-stack-gap":no(a),"--wp-ui-stack-align":r,"--wp-ui-stack-justify":i};return ua({render:s,ref:p,props:q({style:w,className:l},m)})});var me=o(b()),ca=o(D()),G=o(v()),x=o(d());import{usePostFields as so}from"@zero-admin/fields-next";import{unlock as lo}from"@zero-admin/admin-toolkit";import{DataForm as fo}from"@zero-admin/dataviews";var{PostCardPanel:mo}=lo(ca.privateApis);function qe(){let e=(0,G.useEntityId)("postType","attachment"),{post:t,editedPost:a,postTypeObject:r}=(0,me.useSelect)(p=>{let{getEntityRecord:l,getEditedEntityRecord:w,getPostType:E}=p(G.store);return{post:l("postType","attachment",e,{_embed:"wp:attached-to"}),editedPost:w("postType","attachment",e),postTypeObject:E("attachment")}},[e]),{fields:i}=so({postType:"attachment"}),n=r?.quick_edit_form,{editEntityRecord:s}=(0,me.useDispatch)(G.store),m=p=>{s("postType","attachment",e,p)};return t?(0,x.jsx)("div",{className:"zero-admin-media-editor-sidebar__details",children:(0,x.jsx)($,{direction:"column",gap:4,children:a&&(0,x.jsxs)(x.Fragment,{children:[(0,x.jsx)(mo,{postType:t?.type,postId:e}),!!n&&i.length>0&&(0,x.jsx)(fo,{data:a,fields:i,form:n,onChange:m})]})})}):null}if(!document.head.querySelector("style[data-wp-hash='0d2a7b8437']")){let e=document.createElement("style");e.setAttribute("data-wp-hash","0d2a7b8437"),e.appendChild(document.createTextNode(`.zero-admin-media-editor-sidebar__details {
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
`)),document.head.appendChild(e)}var ue=o(d()),po="core/edit-media",co="core/edit-media/details",_o=_a.Platform.select({web:!0}),{ComplementaryArea:ho}=uo(ha.privateApis);function $e(){return(0,ue.jsx)(ho,{className:"zero-admin-media-editor-sidebar",title:(0,W.__)("Details","zero-admin"),closeLabel:(0,W.__)("Close details","zero-admin"),scope:po,identifier:co,icon:(0,W.isRTL)()?Me:Te,isActiveByDefault:_o,children:(0,ue.jsx)("div",{className:"zero-admin-media-editor-sidebar__tabs-panel",children:(0,ue.jsx)(qe,{})})})}var xa=o(b()),pe=o(v());var ba=o(M());var ga=o(d());function Ge(){return(0,ga.jsx)(j,{icon:U,size:128})}var A=o(T(),1);if(!document.head.querySelector("style[data-wp-hash='fd022c9450']")){let e=document.createElement("style");e.setAttribute("data-wp-hash","fd022c9450"),e.appendChild(document.createTextNode(`.zero-admin-media-loading {
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
  display: flex;
}

.zero-admin-media-loading .components-spinner {
  margin: 0;
}
`)),document.head.appendChild(e)}var P=o(d(),1);function N({resource:e}){return e.kind==="error"?(0,P.jsxs)(A.Notice,{status:"error",isDismissible:!1,children:[e.message," ",(0,P.jsx)(A.Button,{variant:"secondary",onClick:e.retry,children:"Retry media"})]}):(0,P.jsx)("div",{className:"zero-admin-media-loading",children:(0,P.jsx)(A.Spinner,{})})}var ya=o(k(),1);function L(e,t,a){let r=(0,ya.useCallback)(()=>{},[]);return{kind:"ready",url:t,retry:r}}var We=o(d());function Xe({post:e}){let t=L(e?.id,e?.source_url,e?.modified),a=t.kind==="ready"?t.url:void 0;return t.kind!=="ready"?(0,We.jsx)(N,{resource:t}):e?(0,We.jsx)("audio",{controls:!0,src:a,autoPlay:!1,preload:"true"}):null}var wa=o(d());function Ye({sourceUrl:e,altText:t}){return(0,wa.jsx)("img",{className:"zero-admin-media-editor-content__image",src:e,alt:t})}var Ze=o(d());function Je({post:e}){let t=L(e?.id,e?.source_url,e?.modified),a=t.kind==="ready"?t.url:void 0;return t.kind!=="ready"?(0,Ze.jsx)(N,{resource:t}):e?(0,Ze.jsx)(Ye,{sourceUrl:a??"",altText:e.alt_text}):null}var Qe=o(d());function Ke({post:e}){let t=L(e?.id,e?.source_url,e?.modified),a=t.kind==="ready"?t.url:void 0;return t.kind!=="ready"?(0,Qe.jsx)(N,{resource:t}):e?(0,Qe.jsx)("video",{className:"zero-admin-media-editor-content__video",controls:!0,preload:"true",src:a}):null}if(!document.head.querySelector("style[data-wp-hash='eceffafdfe']")){let e=document.createElement("style");e.setAttribute("data-wp-hash","eceffafdfe"),e.appendChild(document.createTextNode(`.zero-admin-media-editor-content__image, .zero-admin-media-editor-content__video {
  object-fit: contain;
  width: auto;
  max-width: 100%;
  height: auto;
  max-height: 100%;
  transition: opacity .2s ease-in-out;
}
`)),document.head.appendChild(e)}var va=o(d()),go={application:Ge,audio:Xe,image:Je,video:Ke};function et({post:e}){let t=(0,ba.useMemo)(()=>de(e.mime_type||""),[e.mime_type]),a=go[t.type];return a?(0,va.jsx)(a,{post:e}):null}var tt=o(d());function at(){let e=(0,pe.useEntityId)("postType","attachment"),t=(0,xa.useSelect)(a=>a(pe.store).getEntityRecord("postType","attachment",e,{_embed:"author,wp:attached-to"}),[e]);return t?(0,tt.jsx)($,{className:K("zero-admin-media-details__content-container"),direction:"column",justify:"center",align:"center",gap:2,children:(0,tt.jsx)(et,{post:t})}):null}if(!document.head.querySelector("style[data-wp-hash='da93859de0']")){let e=document.createElement("style");e.setAttribute("data-wp-hash","da93859de0"),e.appendChild(document.createTextNode(`.zero-admin-site-editor__media-editor-layout {
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
`)),document.head.appendChild(e)}var h=o(d()),{InterfaceSkeleton:bo,ComplementaryArea:vo}=yo(ka.privateApis);function ot({isPreview:e,editLink:t}){let a=wo({to:t,className:"zero-admin-site-editor__hyperlink"});return(0,h.jsxs)("div",{className:"zero-admin-site-editor zero-admin-site-editor__media-editor-layout",children:[(0,h.jsx)(bo,{header:!e&&(0,h.jsx)(Ve,{backLink:t.startsWith("/collections/")?t.slice(0,t.lastIndexOf("/")):void 0}),sidebar:!e&&(0,h.jsx)(vo.Slot,{scope:"core/edit-media"}),content:(0,h.jsx)(at,{}),secondarySidebar:null}),e&&(0,h.jsx)("a",{...a,"aria-label":(0,Ra.__)("Edit","zero-admin")}),(0,h.jsx)(ve,{}),(0,h.jsx)($e,{})]})}var X=o(d());function ce({postType:e="attachment",postId:t,children:a,isPreview:r=!1,editLink:i}){let{record:n,isResolving:s}=(0,Ea.useEntityRecord)("postType",e,t);if(!s&&!n)return(0,X.jsx)(za.Notice,{status:"error",isDismissible:!1,children:(0,Ma.__)("You attempted to edit an item that doesn't exist. Perhaps it was deleted?","zero-admin")});let m=i??`/media/${t}`;return(0,X.jsxs)(gt,{post:n,children:[(0,X.jsx)(ot,{isPreview:r,editLink:m}),a]})}var Sa=o(b()),Ta=o(v());import{loadView as xo}from"@zero-admin/views";var ko={type:"table",sort:{field:"date",direction:"desc"},fields:["title","author","status","date"]};function Ro(e,t){if(e?.views&&t){let r=e.views.find(i=>i.slug===t);if(r?.view)return r.view}return{...e?.default_view??ko,showLevels:e?.hierarchical}}async function _e(e,t,a){let r=await(0,Sa.resolveSelect)(Ta.store).getPostType(e),i=Ro(r,t);return xo({kind:"postType",name:e,defaultView:i,queryParams:a})}var rn={inspector:async({params:e,search:t})=>{if((await _e("attachment",t?.slug,t)).type!=="list")return t.edit===!0},canvas:async({params:e,search:t})=>{let a=await _e("attachment",t?.slug,t);if(a.type!=="list")return;let i=(await(0,g.resolveSelect)(y.store).getEntityRecords("postType","attachment",Ia(a,"attachment")))?.[0];return i?{postType:"attachment",postId:t.postIds?t.postIds[0]:i.id,isPreview:!0,component:ce}:{postType:"attachment",isPreview:!0}},loader:async({params:e,search:t})=>{let a=await _e("attachment",t?.slug,t),r=Ia(a,"attachment"),i=(0,g.resolveSelect)(y.store).getPostType("attachment").then(n=>n?.taxonomies?.length?(0,g.resolveSelect)(y.store).getTaxonomies({type:"attachment"}):[]).then(n=>Promise.all((n??[]).filter(s=>s.show_in_rest||s.rest_base).map(s=>(0,g.resolveSelect)(y.store).getEntityRecords("taxonomy",s.slug,{per_page:-1}))));await Promise.all([(0,g.resolveSelect)(y.store).getEntityRecords("postType","attachment",r),(0,g.resolveSelect)(y.store).getEntityRecords("root","user",{per_page:-1}),(0,g.resolveSelect)(y.store).getEntityRecords("root","status",{per_page:-1}),(0,g.resolveSelect)(y.store).canUser("create",{kind:"postType",name:"attachment"}),i,Eo("postType","attachment")])},beforeLoad:async()=>{try{if(!(await(0,g.resolveSelect)(y.store).getPostType("attachment"))?.visibility?.show_ui)throw Ca()}catch{throw Ca()}}};export{rn as route};
