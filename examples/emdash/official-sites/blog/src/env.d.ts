declare namespace App {
  interface Locals {
    user?: { id: number; name: string };
    emdash?: { getPublicMediaUrl?: (key: string) => string };
  }
}
