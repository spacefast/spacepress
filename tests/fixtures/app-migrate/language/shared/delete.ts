// `delete` shapes from live 0.8 apps: strip optional fields before a record leaves a handler.
type Profile = { name: string; password?: string; token?: string };

export function publicProfile(profile: Profile): Profile {
  const copy: Profile = { ...profile };
  delete copy.password;
  delete copy["token"];
  return copy;
}

export function forget(cache: Record<string, number>, key: string): boolean {
  return delete cache[key];
}
