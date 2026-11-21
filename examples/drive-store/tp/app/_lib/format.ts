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

