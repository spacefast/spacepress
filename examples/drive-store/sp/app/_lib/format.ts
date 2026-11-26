
export function money(amount: string | null): string {
  if (amount === null) return "Price unavailable";
  return `$${amount}`;
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

export function stockLabel(quantity: number | null, availability: string): string {
  if (availability !== "instock") return "Sold out";
  return quantity === null ? "In stock" : `${quantity} in stock`;
}
