#!/usr/bin/env bash
# Seeds a 0.3.0 site through its own HTTP API (used by stage.sh). Prints what it wrote as one JSON
# line: ids of the rows it made and the session cookie of a member who signed in.
set -euo pipefail
url=$1; ed=$2

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
api="$url/wp-json/zero/v1"
auth="editor:$ed"
j() { python3 -c 'import json,sys; v=json.load(sys.stdin)
for k in sys.argv[1].split("."): v=v[int(k)] if isinstance(v,list) else v[k]
print(v)' "$1"; }
note=$(curl -sS -u "$auth" -H 'content-type: application/json' -X POST "$api/notes" --data '{"title":"Kept note"}' | j data.id)
curl -sS -u "$auth" -H 'content-type: application/json' -X POST "$api/notes" --data '{"title":"Second note","done":true}' >/dev/null
printf 'deck contents' > "$work"/deck.txt
file=$(curl -sS -u "$auth" -F "file=@"$work"/deck.txt;type=text/plain" "$api/files/decks" | j data.id)
post=$(curl -sS -u "$auth" -H 'content-type: application/json' -X POST "$api/posts" --data "{\"title\":\"First post\",\"summary\":\"Written by 0.3\",\"tags\":[\"news\"],\"deck\":$file,\"status\":\"published\"}" | j data.id)
curl -sS -u "$auth" -H 'content-type: application/json' -X PATCH "$api/posts/$post" --data '{"summary":"Edited by 0.3"}' >/dev/null
curl -sS -u "$auth" -H 'content-type: application/json' -X PATCH "$api/globals/settings" --data '{"siteTitle":"Carried over"}' >/dev/null
# A member who signs up and signs in through zero-identity: a session under the 0.3 digest.
curl -sS -H 'content-type: application/json' -H "origin: $url" -X POST "$url/wp-json/zero-identity/v1/sign-in/password" --data '{"login":"subscriber","password":"zero-test-subscriber"}' -D "$work"/signin.h -o "$work"/signin.json
cookie=$(grep -i '^set-cookie: zi_session=' "$work"/signin.h | head -1 | sed -E 's/^[Ss]et-[Cc]ookie: ([^;]*).*/\1/' | tr -d '\r')
# A job waiting in the queue (Action Scheduler holds its delivery).
curl -sS -H 'content-type: application/json' -X POST "$api/actions/later" --data "{\"id\":$note}" >/dev/null
python3 -c 'import json,sys; print(json.dumps({"note":int(sys.argv[1]),"post":int(sys.argv[2]),"file":int(sys.argv[3]),"cookie":sys.argv[4]}))' "$note" "$post" "$file" "$cookie"
