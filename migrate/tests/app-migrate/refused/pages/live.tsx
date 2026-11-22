"use client";
import { useQuery } from "@spacefast/zero/client";
export default function Live() { const rows = useQuery<string[]>("identity") ?? []; return <p>{rows.length}</p>; }
