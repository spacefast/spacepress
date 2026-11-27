// "spacepress/commerce": native WooCommerce store, product, taxonomy, and order builders.
import type { Collection, ColumnBuilder } from "./index.d.ts";

declare const storeBrand: unique symbol;

export interface StoreOptions {
  currency: string;
  country: string;
  address?: { line1: string; line2?: string; city: string; postcode: string };
  sellTo?: "all" | readonly string[];
  units?: { weight: "kg" | "g" | "lbs" | "oz"; dimension: "m" | "cm" | "mm" | "in" | "yd" };
  shipping?: readonly {
    name: string;
    countries: "rest" | readonly string[];
    methods: readonly (
      | { type: "flatRate"; title: string; cost: string }
      | { type: "freeShipping"; title: string; minimum?: string }
      | { type: "localPickup"; title: string; cost?: string }
    )[];
  }[];
  payments?: readonly string[];
  email?: { fromName: string; fromAddress: string };
  checkout?: `/${string}`;
}

export interface CommerceStore {
  readonly [storeBrand]: true;
}

export declare function store(options: StoreOptions): CommerceStore;

export interface CommerceOptions {
  sync?: string;
  agents?: boolean;
  label?: string;
  api?: false | { list?: boolean; get?: boolean; create?: boolean; update?: boolean; delete?: boolean };
}

type ProductFieldKind = "text" | "integer" | "number" | "boolean" | "date" | "email" | "url";
type ProductFields = Record<string, ColumnBuilder<ProductFieldKind, any, false, false, false, false>>;

type WithId<T> = T & { id: ColumnBuilder<"id", number, true, true, false, true> };

type TermColumns<THierarchical extends boolean> = {
  name: ColumnBuilder<"text", string, true, false>;
  slug: ColumnBuilder<"slug", string, true, true>;
  description: ColumnBuilder<"text", string, true, true>;
  count: ColumnBuilder<"integer", number, true, true>;
  url: ColumnBuilder<"text", string, false, true>;
} & (THierarchical extends true ? { parent: ColumnBuilder<"integer", number, false, false> } : {});

type ProductColumns<F extends ProductFields, I extends boolean> = WithId<
  {
    uid: ColumnBuilder<"text", string, true, true>;
    name: ColumnBuilder<"text", string, true, false>;
    slug: ColumnBuilder<"slug", string, true, true>;
    description: ColumnBuilder<"richText", string, true, true>;
    sku: ColumnBuilder<"text", string, false, false>;
    shortDescription: ColumnBuilder<"text", string, false, false>;
    price: ColumnBuilder<"text", string, false, false>;
    status: ColumnBuilder<"text", "draft" | "pending" | "scheduled" | "published" | "private", true, true>;
    images: ColumnBuilder<"mediaList", number[], true, true>;
    virtual: ColumnBuilder<"boolean", boolean, true, true>;
    downloadable: ColumnBuilder<"boolean", boolean, true, true>;
    downloads: ColumnBuilder<"repeater", { id: string; name: string; file: string }[], true, true>;
    type: ColumnBuilder<"text", string, true, true>;
    purchasable: ColumnBuilder<"boolean", boolean, true, true>;
    availability: ColumnBuilder<"text", string, true, true>;
    url: ColumnBuilder<"text", string, false, true>;
  } & (I extends true ? { stockQuantity: ColumnBuilder<"integer", number, false, true> } : {}) &
    F
>;

export declare function product<F extends ProductFields = {}, I extends boolean = false>(
  options?: CommerceOptions & { fields?: F; inventory?: I; reviews?: boolean },
): Collection<string, ProductColumns<F, I>, false, "product">;

export declare function productCategory(
  options?: CommerceOptions,
): Collection<string, WithId<TermColumns<true> & { uid: ColumnBuilder<"text", string, true, true> }>, false, "taxonomy", true>;

export declare function productTag(
  options?: CommerceOptions,
): Collection<string, WithId<TermColumns<false> & { uid: ColumnBuilder<"text", string, true, true> }>, false, "taxonomy">;

export interface OrderAddress {
  first_name: string;
  last_name: string;
  company: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  email: string | null;
  phone: string | null;
}

export interface OrderLine {
  id: number;
  name: string;
  product: number;
  variation: number | null;
  quantity: number;
  subtotal: string;
  subtotalTax: string;
  total: string;
  totalTax: string;
  taxes: unknown;
}

export declare function order(
  options?: Pick<CommerceOptions, "agents" | "label"> & { api?: false | { list?: boolean; get?: boolean } },
): Collection<
  string,
  WithId<{
    status: ColumnBuilder<"text", string, true, true>;
    currency: ColumnBuilder<"text", string, true, true>;
    precision: ColumnBuilder<"integer", number, true, true>;
    createdAt: ColumnBuilder<"timestamp", string, true, true>;
    updatedAt: ColumnBuilder<"timestamp", string, true, true>;
    paidAt: ColumnBuilder<"timestamp", string, false, true>;
    completedAt: ColumnBuilder<"timestamp", string, false, true>;
    customer: ColumnBuilder<"integer", number, false, true>;
    paymentMethod: ColumnBuilder<"text", string, true, true>;
    paymentTitle: ColumnBuilder<"text", string, true, true>;
    total: ColumnBuilder<"text", string, true, true>;
    subtotal: ColumnBuilder<"text", string, true, true>;
    discountTotal: ColumnBuilder<"text", string, true, true>;
    shippingTotal: ColumnBuilder<"text", string, true, true>;
    taxTotal: ColumnBuilder<"text", string, true, true>;
    billing: ColumnBuilder<"group", OrderAddress, true, true>;
    shipping: ColumnBuilder<"group", OrderAddress, true, true>;
    lines: ColumnBuilder<"repeater", OrderLine[], true, true>;
    shippingLines: ColumnBuilder<"repeater", { id: number; name: string; method_id: string; instance_id: string; total: string; total_tax: string; taxes: unknown }[], true, true>;
    taxLines: ColumnBuilder<"repeater", { id: number; name: string; rate_id: number; label: string; compound: boolean; tax_total: string; shipping_tax_total: string }[], true, true>;
    feeLines: ColumnBuilder<"repeater", { id: number; name: string; total: string; total_tax: string; taxes: unknown }[], true, true>;
    couponLines: ColumnBuilder<"repeater", { id: number; name: string; code: string; discount: string; discount_tax: string }[], true, true>;
    refunds: ColumnBuilder<"repeater", { id: number; amount: string; reason: string; createdAt: string }[], true, true>;
  }>,
  false,
  "order"
>;
