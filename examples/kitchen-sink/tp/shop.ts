import { order, product, productCategory, productTag, store } from "typedpress";

export const shop = store({
  currency: "USD", country: "US", sellTo: ["US"], payments: ["cod"],
  shipping: [{ name: "United States", countries: ["US"], methods: [{ type: "localPickup", title: "Kitchen pickup" }] }],
});
export const supplies = product({ label: "Kitchen supplies", sync: "content/supplies/*.md" });
export const supplyCategories = productCategory();
export const supplyTags = productTag();
export const orders = order();
