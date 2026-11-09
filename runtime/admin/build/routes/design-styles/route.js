import '__i18n__';
var Ae=Object.create;var Q=Object.defineProperty;var Re=Object.getOwnPropertyDescriptor;var Te=Object.getOwnPropertyNames;var Ie=Object.getPrototypeOf,Le=Object.prototype.hasOwnProperty;var x=(t,e)=>()=>(e||t((e={exports:{}}).exports,e),e.exports);var Me=(t,e,o,r)=>{if(e&&typeof e=="object"||typeof e=="function")for(let s of Te(e))!Le.call(t,s)&&s!==o&&Q(t,s,{get:()=>e[s],enumerable:!(r=Re(e,s))||r.enumerable});return t};var l=(t,e,o)=>(o=t!=null?Ae(Ie(t)):{},Me(e||!t||!t.__esModule?Q(o,"default",{value:t,enumerable:!0}):o,t));var D=x((mt,ee)=>{"use strict";ee.exports=window.wp.data});var V=x((pt,te)=>{"use strict";te.exports=window.wp.coreData});var R=x((ut,se)=>{"use strict";se.exports=window.wp.components});var T=x((ft,re)=>{"use strict";re.exports=window.wp.i18n});var $=x((gt,ne)=>{"use strict";ne.exports=window.wp.blockEditor});var H=x((yt,ie)=>{"use strict";ie.exports=window.wp.element});var K=x((xt,ce)=>{"use strict";ce.exports=window.wp.blocks});var h=x((kt,me)=>{"use strict";me.exports=window.ReactJSXRuntime});var ge=x((Bt,fe)=>{"use strict";fe.exports=window.wp.editor});var be=x((Ft,ye)=>{"use strict";ye.exports=window.wp.mediaUtils});var we=x((Tt,Ee)=>{"use strict";Ee.exports=function t(e,o){if(e===o)return!0;if(e&&o&&typeof e=="object"&&typeof o=="object"){if(e.constructor!==o.constructor)return!1;var r,s,i;if(Array.isArray(e)){if(r=e.length,r!=o.length)return!1;for(s=r;s--!==0;)if(!t(e[s],o[s]))return!1;return!0}if(e instanceof Map&&o instanceof Map){if(e.size!==o.size)return!1;for(s of e.entries())if(!o.has(s[0]))return!1;for(s of e.entries())if(!t(s[1],o.get(s[0])))return!1;return!0}if(e instanceof Set&&o instanceof Set){if(e.size!==o.size)return!1;for(s of e.entries())if(!o.has(s[0]))return!1;return!0}if(ArrayBuffer.isView(e)&&ArrayBuffer.isView(o)){if(r=e.length,r!=o.length)return!1;for(s=r;s--!==0;)if(e[s]!==o[s])return!1;return!0}if(e.constructor===RegExp)return e.source===o.source&&e.flags===o.flags;if(e.valueOf!==Object.prototype.valueOf)return e.valueOf()===o.valueOf();if(e.toString!==Object.prototype.toString)return e.toString()===o.toString();if(i=Object.keys(e),r=i.length,r!==Object.keys(o).length)return!1;for(s=r;s--!==0;)if(!Object.prototype.hasOwnProperty.call(o,i[s]))return!1;for(s=r;s--!==0;){var n=i[s];if(!t(e[n],o[n]))return!1}return!0}return e!==e&&o!==o}});var X=l(D()),Z=l(V());function oe(t){var e,o,r="";if(typeof t=="string"||typeof t=="number")r+=t;else if(typeof t=="object")if(Array.isArray(t)){var s=t.length;for(e=0;e<s;e++)t[e]&&(o=oe(t[e]))&&(r&&(r+=" "),r+=o)}else for(o in t)t[o]&&(r&&(r+=" "),r+=o);return r}function Ne(){for(var t,e,o=0,r="",s=arguments.length;o<s;o++)(t=arguments[o])&&(e=oe(t))&&(r&&(r+=" "),r+=e);return r}var A=Ne;var G=l(R()),O=l(T()),_=l($()),d=l(H());import{getStyle as Ce,getPalettes as Ze,generateGlobalStyles as Je}from"@first-admin/global-styles-engine";var a=l(T()),I=[{slug:"theme-colors",title:(0,a.__)("Theme Colors","first-admin"),origin:"theme",type:"colors"},{slug:"theme-gradients",title:(0,a.__)("Theme Gradients","first-admin"),origin:"theme",type:"gradients"},{slug:"custom-colors",title:(0,a.__)("Custom Colors","first-admin"),origin:"custom",type:"colors"},{slug:"custom-gradients",title:(0,a.__)("Custom Gradients","first-admin"),origin:"custom",type:"gradients"},{slug:"duotones",title:(0,a.__)("Duotones","first-admin"),origin:"theme",type:"duotones"},{slug:"default-colors",title:(0,a.__)("Default Colors","first-admin"),origin:"default",type:"colors"},{slug:"default-gradients",title:(0,a.__)("Default Gradients","first-admin"),origin:"default",type:"gradients"}],Y=[{slug:"site-identity",title:(0,a.__)("Site Identity","first-admin"),blocks:["core/site-logo","core/site-title","core/site-tagline"]},{slug:"design",title:(0,a.__)("Design","first-admin"),blocks:["core/navigation","core/avatar","core/post-time-to-read"],exclude:["core/home-link","core/navigation-link"]},{slug:"posts",title:(0,a.__)("Posts","first-admin"),blocks:["core/post-title","core/post-excerpt","core/post-author","core/post-author-name","core/post-author-biography","core/post-date","core/post-terms","core/term-description","core/query-title","core/query-no-results","core/query-pagination","core/query-numbers"]},{slug:"comments",title:(0,a.__)("Comments","first-admin"),blocks:["core/comments-title","core/comments-pagination","core/comments-pagination-numbers","core/comments","core/comments-author-name","core/comment-content","core/comment-date","core/comment-edit-link","core/comment-reply-link","core/comment-template","core/post-comments-count","core/post-comments-link"]}],Ue=[{slug:"overview",title:(0,a.__)("Overview","first-admin"),blocks:[]},{slug:"text",title:(0,a.__)("Text","first-admin"),blocks:["core/post-content","core/home-link","core/navigation-link"]},{slug:"colors",title:(0,a.__)("Colors","first-admin"),blocks:[]},{slug:"theme",title:(0,a.__)("Theme","first-admin"),subcategories:Y},{slug:"media",title:(0,a.__)("Media","first-admin"),blocks:["core/post-featured-image"]},{slug:"widgets",title:(0,a.__)("Widgets","first-admin"),blocks:[]},{slug:"embed",title:(0,a.__)("Embeds","first-admin"),include:[]}],We=[...Y,{slug:"media",title:(0,a.__)("Media","first-admin"),blocks:["core/post-featured-image"]},{slug:"widgets",title:(0,a.__)("Widgets","first-admin"),blocks:[]},{slug:"embed",title:(0,a.__)("Embeds","first-admin"),include:[]}],le=[{slug:"overview",title:(0,a.__)("Overview","first-admin"),blocks:[]},{slug:"text",title:(0,a.__)("Text","first-admin"),blocks:["core/post-content","core/home-link","core/navigation-link"]},{slug:"colors",title:(0,a.__)("Colors","first-admin"),blocks:[]},{slug:"blocks",title:(0,a.__)("All Blocks","first-admin"),blocks:[],subcategories:We}],De=`
	.is-root-container {
		display: flow-root;
	}
`,ae=`
	body {
		position: relative;
		padding: 32px !important;
	}

	${De}

	.first-admin-style-book__examples {
		max-width: 1200px;
		margin: 0 auto;
	}

	.first-admin-style-book__example {
	    max-width: 900px;
		border-radius: 2px;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 40px;
		padding: 16px;
		width: 100%;
		box-sizing: border-box;
		scroll-margin-top: 32px;
		scroll-margin-bottom: 32px;
		margin: 0 auto 40px auto;
	}

	.first-admin-style-book__example.is-selected {
		box-shadow: 0 0 0 1px var(--wpds-color-stroke-focus-brand);
	}

	.first-admin-style-book__example.is-disabled-example {
		pointer-events: none;
	}

	.first-admin-style-book__example:focus:not(:disabled) {
		box-shadow: 0 0 0 var(--wpds-border-width-focus) var(--wpds-color-stroke-focus-brand);
		outline: 3px solid transparent;
	}

	.first-admin-style-book__duotone-example > div:first-child {
		display: flex;
		aspect-ratio: 16 / 9;
		grid-row: span 1;
		grid-column: span 2;
	}
	.first-admin-style-book__duotone-example img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.first-admin-style-book__duotone-example > div:not(:first-child) {
		height: 20px;
		border: 1px solid color-mix( in srgb, currentColor 10%, transparent );
	}

	.first-admin-style-book__color-example {
		border: 1px solid color-mix( in srgb, currentColor 10%, transparent );
	}

	.first-admin-style-book__subcategory-title,
	.first-admin-style-book__example-title {
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
		font-size: 13px;
		font-weight: normal;
		line-height: normal;
		margin: 0;
		text-align: left;
		padding-top: 8px;
		border-top: 1px solid color-mix( in srgb, currentColor 10%, transparent );
		color: color-mix( in srgb, currentColor 60%, transparent );
	}

	.first-admin-style-book__subcategory-title {
		font-size: 16px;
		margin-bottom: 40px;
    	padding-bottom: 8px;
	}

	.first-admin-style-book__example-preview {
		width: 100%;
	}

	.first-admin-style-book__example-preview .block-editor-block-list__insertion-point,
	.first-admin-style-book__example-preview .block-list-appender {
		display: none;
	}
	:where(.is-root-container > .wp-block:first-child) {
		margin-top: 0;
	}
	:where(.is-root-container > .wp-block:last-child) {
		margin-bottom: 0;
	}
`;var Ve=l(K());function L(t,e){if(!t?.slug||!e?.length)return;let o=t?.subcategories??[];if(o.length){let n=o.map(m=>L(m,e)).filter(m=>m!==void 0);return{title:t.title,slug:t.slug,subcategories:n.length>0?n:void 0}}let r=t?.blocks||[],s=t?.exclude||[],i=e.filter(n=>!s.includes(n.name)&&(n.category===t.slug||r.includes(n.name)));if(i.length)return{title:t.title,slug:t.slug,examples:i}}var k=l(T()),g=l(K());var pe=l(R()),M=l($()),z=l(h()),$e=({colors:t,type:e,templateColumns:o="1fr 1fr",itemHeight:r="52px"})=>t?(0,z.jsx)(pe.__experimentalGrid,{templateColumns:o,rowGap:8,columnGap:16,children:t.map(s=>{let i=e==="gradients"?(0,M.__experimentalGetGradientClass)(s.slug):(0,M.getColorClassName)("background-color",s.slug),n=A("first-admin-style-book__color-example",i);return(0,z.jsx)("div",{className:n,style:{height:r}},s.slug)})}):null,q=$e;var j=l(R()),C=l(h()),He=({duotones:t})=>t?(0,C.jsx)(j.__experimentalGrid,{columns:2,rowGap:16,columnGap:16,children:t.map(e=>(0,C.jsxs)(j.__experimentalGrid,{className:"first-admin-style-book__duotone-example",columns:2,rowGap:8,columnGap:8,children:[(0,C.jsx)("div",{children:(0,C.jsx)("img",{alt:`Duotone example: ${e.slug}`,src:"https://s.w.org/images/core/5.3/MtBlanc1.jpg",style:{filter:`url(#wp-duotone-${e.slug})`}})}),e.colors.map(o=>(0,C.jsx)("div",{className:"first-admin-style-book__color-example",style:{backgroundColor:o}},o))]},e.slug))}):null,de=He;var N=l(h());function Ye(t){if(!t)return[];let e=[];return I.forEach(o=>{let r=t[o.type],s=Array.isArray(r)?r.find(i=>i.slug===o.origin):void 0;if(s?.[o.type]){let i={name:o.slug,title:o.title,category:"colors",blocks:null};o.type==="duotones"?(i.content=(0,N.jsx)(de,{duotones:s[o.type]}),e.push(i)):(i.content=(0,N.jsx)(q,{colors:s[o.type],type:o.type}),e.push(i))}}),e}function Ke(t){let e=[],o=Array.isArray(t?.colors)?t.colors.find(i=>i.slug==="theme")?.colors:void 0;if(o){let i={name:"theme-colors",title:(0,k.__)("Colors","first-admin"),category:"overview",blocks:null,content:(0,N.jsx)(q,{colors:o,type:"colors",templateColumns:"repeat(auto-fill, minmax( 200px, 1fr ))",itemHeight:"32px"})};e.push(i)}let r=[];if((0,g.getBlockType)("core/heading")){let i=(0,g.createBlock)("core/heading",{content:(0,k.__)("AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0123456789X{(\u2026)},.-<>?!*&:/A@HELFO\u2122\xA9","first-admin"),level:1});r.push(i)}if((0,g.getBlockType)("core/paragraph")){let i=(0,g.createBlock)("core/paragraph",{content:(0,k.__)("A paragraph in a website refers to a distinct block of text that is used to present and organize information. It is a fundamental unit of content in web design and is typically composed of a group of related sentences or thoughts focused on a particular topic or idea. Paragraphs play a crucial role in improving the readability and user experience of a website. They break down the text into smaller, manageable chunks, allowing readers to scan the content more easily.","first-admin")}),n=(0,g.createBlock)("core/paragraph",{content:(0,k.__)("Additionally, paragraphs help structure the flow of information and provide logical breaks between different concepts or pieces of information. In terms of formatting, paragraphs in websites are commonly denoted by a vertical gap or indentation between each block of text. This visual separation helps visually distinguish one paragraph from another, creating a clear and organized layout that guides the reader through the content smoothly.","first-admin")});if((0,g.getBlockType)("core/group")){let m=(0,g.createBlock)("core/group",{layout:{type:"grid",columnCount:2,minimumColumnWidth:"12rem"},style:{spacing:{blockGap:"1.5rem"}}},[i,n]);r.push(m)}else r.push(i)}return r.length&&e.push({name:"typography",title:(0,k.__)("Typography","first-admin"),category:"overview",blocks:r}),["core/image","core/separator","core/buttons","core/pullquote","core/search"].forEach(i=>{let n=(0,g.getBlockType)(i);if(n&&n.example){let m={name:i,title:n.title,category:"overview",blocks:(0,g.getBlockFromExample)(i,{...n.example,attributes:{...n.example?.attributes,style:void 0}})};e.push(m)}}),e}function ue(t){let e=(0,g.getBlockTypes)().filter(n=>{let{name:m,example:u,supports:E}=n;return m!=="core/heading"&&!!u&&E?.inserter!==!1}).map(n=>({name:n.name,title:n.title,category:n.category,blocks:(0,g.getBlockFromExample)(n.name,{...n.example,attributes:{...n.example?.attributes,style:void 0}})}));if(!!!(0,g.getBlockType)("core/heading"))return e;let r={name:"core/heading",title:(0,k.__)("Headings","first-admin"),category:"text",blocks:[1,2,3,4,5,6].map(n=>(0,g.createBlock)("core/heading",{content:(0,k.sprintf)((0,k.__)("Heading %d","first-admin"),n),level:n}))},s=Ye(t),i=Ke(t);return[r,...s,...e,...i]}if(!document.head.querySelector("style[data-wp-hash='7b062f2af7']")){let t=document.createElement("style");t.setAttribute("data-wp-hash","7b062f2af7"),t.appendChild(document.createTextNode(`.first-admin-style-book {
  width: 100%;
  height: 100%;
}

.first-admin-style-book.is-button {
  border-radius: 8px;
}

.first-admin-style-book {
  flex-direction: column;
  align-items: stretch;
  display: flex;
}

.first-admin-style-book__iframe {
  width: 100%;
  height: 100%;
  display: block;
}

.first-admin-style-book__iframe.is-button {
  border-radius: 8px;
}

.first-admin-style-book__iframe.is-focused {
  outline: calc(2 * var(--wpds-border-width-focus)) solid var(--wpds-color-stroke-focus-brand);
  outline-offset: calc(-2 * var(--wpds-border-width-focus));
}
`)),document.head.appendChild(t)}var U=l(V()),W=l(D()),P=l(H()),xe=l(ge()),he=l(be());import{useNavigate as ze,useSearch as qe}from"@wordpress/route";import{mergeGlobalStyles as je}from"@first-admin/global-styles-engine";function Se(t){let{userGlobalStyles:e}=(0,W.useSelect)(r=>{let{getEntityRecord:s,getEditedEntityRecord:i,canUser:n}=r(U.store),m=n("update",{kind:"root",name:"globalStyles",id:t}),u;return typeof m=="boolean"&&(m?u=i("root","globalStyles",t):u=s("root","globalStyles",t,{context:"view"})),{userGlobalStyles:u}},[t]),o=(0,W.useSelect)(r=>r(U.store).__experimentalGetCurrentThemeBaseGlobalStyles(),[]);return(0,P.useMemo)(()=>{if(!e||!o)return{user:void 0,base:void 0,merged:void 0};let r=e,s=o,i=je(s,r);return{user:r,base:s,merged:i}},[e,o])}function ke(){let{styles:t,__unstableResolvedAssets:e,colors:o,gradients:r,__experimentalDiscussionSettings:s,mediaUpload:i}=(0,W.useSelect)(u=>{let{getEditorSettings:E}=u(xe.store),{canUser:w}=u(U.store),y=E(),b=w("create",{kind:"root",name:"media"});return{styles:y.styles,__unstableResolvedAssets:y.__unstableResolvedAssets,colors:y.colors,gradients:y.gradients,__experimentalDiscussionSettings:y.__experimentalDiscussionSettings,mediaUpload:b?he.uploadMedia:void 0}},[]),n=(0,P.useMemo)(()=>t?Object.values(t??[]).filter(u=>!u.isGlobalStyles):[],[t]),m=(0,P.useMemo)(()=>({__unstableResolvedAssets:e,settings:{color:{palette:{theme:o},gradients:{theme:r},duotone:{theme:[]}}},__experimentalDiscussionSettings:s,mediaUpload:i}),[o,r,e,s,i]);return[n,m]}function _e(){let t=ze(),e=qe({from:"/design/styles"});return(0,P.useMemo)(()=>[e.section,s=>{t({search:{...e,section:s}})}],[t,e])}var Xe=l(we());function ve(t){return t?`is-style-${t}`:""}var c=l(h()),Qe=t=>t&&typeof t=="string"&&(t==="/"||t.startsWith("/typography")||t.startsWith("/colors")||t.startsWith("/blocks"))?{top:!0}:null;function et(t,e){return e?t.map(o=>({...o,variation:e,blocks:{...o.blocks,attributes:{...o.blocks.attributes,style:void 0,className:ve(e)}}})):t}function tt(t){let e=[],o=L({slug:"overview",title:"Overview"},t);o?.examples&&e.push(...o.examples);let r=t.filter(s=>s.category!=="overview"&&!o?.examples?.find(i=>i.name===s.name));return e.push(...r),e}var ot=(t,e)=>{if(!t||!e||!e?.contentDocument)return;let o=t==="top"?e.contentDocument.body:e.contentDocument.getElementById(t);o&&o.scrollIntoView({behavior:"smooth"})},st=({id:t})=>{let{merged:e}=Se(t),[o,r]=ke(),[s,i]=_e(),n=p=>!!(s===`/blocks/${encodeURIComponent(p)}`||s?.startsWith(`/blocks/${encodeURIComponent(p)}/`)),m=(p,v=!1)=>{if(I.find(Pe=>Pe.slug===p)){i("/colors/palette");return}if(p==="typography"){i("/typography");return}v||i(`/blocks/${encodeURIComponent(p)}`)},u=(0,d.useMemo)(()=>Ce(e,"color.text"),[e]),E=(0,d.useMemo)(()=>Ce(e,"color.background"),[e]),w=(0,d.useMemo)(()=>e||{settings:r?.settings},[e,r]),y=(0,d.useMemo)(()=>Ze(w),[w]),b=(0,d.useMemo)(()=>y?ue(y):[],[y]),f=null,B=null;if(s?.includes("/colors"))f="colors";else if(s?.includes("/typography"))f="text";else if(s?.includes("/blocks")){f="blocks";let p=decodeURIComponent(s).split("/blocks/")[1];p?.includes("/variations")&&([p,B]=p.split("/variations/")),p&&b.find(v=>v.name===p)&&(f=p)}else t&&(f="overview");let S=le.find(p=>p.slug===f),F=(0,d.useMemo)(()=>{if(!S){let p=b.find(v=>v.name===f);return{slug:f||"unknown",title:f||"Unknown",examples:p?[p]:[]}}return L(S,b)},[S,b,f]),J=(0,d.useMemo)(()=>{if(!f)return{slug:"all",title:"All Examples",examples:tt(b)};if(B){let p=(F?.examples||[]).filter(v=>v!==void 0);return{slug:f,title:S?.title||f,examples:et(p,B)}}return F||{slug:"",title:"",examples:[]}},[f,b,B,F,S]),Fe=(0,d.useMemo)(()=>Qe(s),[s]);return!w||!J?null:(0,c.jsx)("div",{className:"first-admin-style-book",style:{color:u,background:E},children:(0,c.jsx)(rt,{category:S,examples:J,isSelected:t?n:void 0,onSelect:t?m:void 0,globalStyles:e,serverCSS:o,serverSettings:r,goTo:Fe})})},rt=({category:t,examples:e,isSelected:o,onSelect:r,globalStyles:s,title:i="",serverCSS:n,serverSettings:m,goTo:u})=>{let[E,w]=Je(s),y=(0,d.useMemo)(()=>[...n??[],...E??[]],[n,E]),b=(0,d.useMemo)(()=>({...m,__experimentalFeatures:w,styles:y,isPreviewMode:!0}),[w,m,y]),[f,B]=(0,d.useState)(!1),S=(0,d.useRef)(null),F=()=>B(!0);return(0,d.useLayoutEffect)(()=>{f&&S?.current&&u?.top&&ot("top",S?.current)},[u,f]),(0,c.jsx)(_.BlockEditorProvider,{settings:b,children:(0,c.jsxs)(_.__unstableIframe,{className:"first-admin-style-book__iframe",name:"style-book-canvas",tabIndex:0,onLoad:F,ref:S,children:[(0,c.jsx)(_.__unstableEditorStyles,{styles:y}),(0,c.jsx)("style",{children:ae}),(0,c.jsx)(nt,{className:"first-admin-style-book__examples",category:t,examples:e,label:i?(0,O.sprintf)((0,O.__)("Examples of blocks in the %s category","first-admin"),i):(0,O.__)("Examples of blocks","first-admin"),isSelected:o,onSelect:r,settings:b},i)]})})},nt=(0,d.memo)(({className:t,examples:e,label:o,isSelected:r,onSelect:s,settings:i})=>(0,c.jsxs)(G.Composite,{orientation:"vertical",className:t,"aria-label":o,role:"grid",children:[e.examples?.length&&e.examples.map(n=>(0,c.jsx)(Ge,{id:`example-${n.name}`,title:n.title,content:n.content,blocks:n.blocks,isSelected:r?.(n.name),onClick:s?()=>s(n.name,!!n.variation):void 0,settings:i},n.name)),e.subcategories?.length&&e.subcategories?.map(n=>(0,c.jsxs)(G.Composite.Group,{className:"first-admin-style-book__subcategory",children:[(0,c.jsx)(G.Composite.GroupLabel,{children:(0,c.jsx)("h2",{className:"first-admin-style-book__subcategory-title",children:n.title})}),(0,c.jsx)(it,{examples:n,isSelected:r,onSelect:s,settings:i})]},`subcategory-${n.slug}`))]})),it=({examples:t,isSelected:e,onSelect:o,settings:r})=>!!t?.examples?.length&&t.examples.map(s=>(0,c.jsx)(Ge,{id:`example-${s.name}`,title:s.title,content:s.content,blocks:s.blocks,isSelected:e?.(s.name),onClick:o?()=>o(s.name):void 0,settings:r},s.name)),lt=["example-duotones"],Ge=({id:t,title:e,blocks:o,isSelected:r,onClick:s,content:i,settings:n})=>{let m=(0,d.useMemo)(()=>Array.isArray(o)?o:[o],[o]),u=lt.includes(t)||!s?{disabled:!0,accessibleWhenDisabled:!!s}:{};return(0,c.jsx)("div",{role:"row",children:(0,c.jsx)("div",{role:"gridcell",children:(0,c.jsxs)(G.Composite.Item,{className:A("first-admin-style-book__example",{"is-selected":r,"is-disabled-example":!!u?.disabled}),id:t,"aria-label":s?(0,O.sprintf)((0,O.__)("Open %s styles in Styles panel","first-admin"),e):void 0,render:(0,c.jsx)("div",{}),role:s?"button":void 0,onClick:s,...u,children:[(0,c.jsx)("span",{className:"first-admin-style-book__example-title",children:e}),(0,c.jsx)("div",{className:"first-admin-style-book__example-preview","aria-hidden":!0,children:(0,c.jsx)(G.Disabled,{className:"first-admin-style-book__example-preview__content",children:i||(0,c.jsx)(_.BlockEditorProvider,{value:m,settings:n,children:(0,c.jsx)(_.BlockList,{renderAppender:!1})})})})]})})})},Oe=st;var Be=l(h());function at({postId:t}){return(0,Be.jsx)(Oe,{id:t})}var Kt={canvas:async({search:t})=>{let e=await(0,X.resolveSelect)(Z.store).__experimentalGetCurrentGlobalStylesId();return t.preview==="stylebook"||!e?{postType:"wp_global_styles",postId:e,component:at,isPreview:!0}:{isPreview:!0}},inspector:async()=>!!await(0,X.resolveSelect)(Z.store).__experimentalGetCurrentGlobalStylesId()};export{Kt as route};
