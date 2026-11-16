import type { Lang } from "../../lib/catalog";

export function money(amount: number, currency: string): string {
  const fixed = amount.toFixed(2);
  if (currency === "USD") return `$${fixed}`;
  if (currency === "EUR") return `€${fixed}`;
  return `${fixed} ₺`;
}

export function size(gb: number): string {
  return gb >= 1000 ? `${(gb / 1000).toFixed(gb % 1000 === 0 ? 0 : 1)} TB` : `${gb} GB`;
}

export function mediaName(media: string): string {
  switch (media) {
    case "hdd": return "HDD";
    case "ssd": return "SSD";
    case "nvme": return "NVMe";
    default: return media;
  }
}

/** The storefront's own words in the visitor's language. Drive names and descriptions come from the drives' translations. */
export function words(lang: Lang) {
  return lang === "tr"
    ? {
        search: "Ara: marka, model, açıklama…", anyMedia: "Her tür", anyCondition: "Her durum", filter: "Filtrele",
        inStock: "stokta", soldOut: "Tükendi", none: "Aramanıza uyan disk yok.", buy: "Satın al", reviews: "Yorumlar",
        demo: "Bu bir demo mağazadır: ödeme alınmaz, hiçbir şey gönderilmez.", name: "Ad", email: "E-posta", quantity: "Adet",
        thanks: "Teşekkürler! Sipariş kodunuz", back: "← Kataloğa dön", capacity: "Kapasite", condition: "Durum",
        hours: "Çalışma saati", iface: "Arayüz", language: "English",
      }
    : {
        search: "Search brand, model, description…", anyMedia: "Any media", anyCondition: "Any condition", filter: "Filter",
        inStock: "in stock", soldOut: "Sold out", none: "No drives match your search.", buy: "Buy", reviews: "Reviews",
        demo: "This is a demo shop: no payment is taken and nothing ships.", name: "Name", email: "Email", quantity: "Quantity",
        thanks: "Thanks! Your order code is", back: "← Back to the catalog", capacity: "Capacity", condition: "Condition",
        hours: "Power-on hours", iface: "Interface", language: "Türkçe",
      };
}
