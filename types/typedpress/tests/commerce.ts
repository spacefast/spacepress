import { store, product, productCategory, productTag, order, taxonomy } from 'typedpress';
export const shop = store({currency:'EUR', country:'PL', payments:['cod'], shipping:[{name:'PL', countries:['PL'], methods:[{type:'flatRate', title:'Courier', cost:'15.00'}]}]});
export const products = product({sync:'content/products/*.md',url:'/products/:slug'});
export const categories = productCategory({sync:'content/categories/*.md',url:'/shop/:path'});
export const tags = productTag();
export const orders = order();
export const topics = taxonomy({}, {sync:'content/topics/*.md'});
const termUid: string = topics.$inferSelect.uid;
const productRow: typeof products.$inferSelect = null!;
const price: string | null = productRow.price;
const orderRow: typeof orders.$inferSelect = null!;
const lineTotal: string = orderRow.lines[0].total;
const address: string = orderRow.billing.city;
const paidAt: string | null = orderRow.paidAt;
// @ts-expect-error Exact decimal money is a string.
store({currency:'EUR',country:'PL',shipping:[{name:'PL',countries:['PL'],methods:[{type:'flatRate',title:'Courier',cost:15}]}]});
// @ts-expect-error V1 access defaults cannot be overridden.
product({access:{read:'anyone'}});
// @ts-expect-error Orders are read-only.
order({api:{create:true}});
// @ts-expect-error No order insert shape exists.
const input: typeof orders.$inferInsert = {status:'pending'};
