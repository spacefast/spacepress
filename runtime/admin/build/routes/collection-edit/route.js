import '__i18n__';
import{allowed as n,bootstrap as c,collectionSpec as l,native as i}from"@zero-admin/schema";var r={canvas:async({params:o})=>{let t=await l(o.collection),e=i(o.collection);if(!(!e||!t.content||!n(t.access.update,c().role)))return{postType:e.postType,postId:o.slug,editLink:`/collections/${o.collection}/${encodeURIComponent(o.slug)}`}}};export{r as route};
