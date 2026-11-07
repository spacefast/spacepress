#!/usr/bin/env python3
"""Generate src/wordpress/catalog.json: the curated WordPress surface `"php/wordpress"` types.

Inputs are pinned below (PINS, by URL and SHA-256) and cached under tests/wp/cache/catalog:
  - @wp-hooks/wordpress-core: actions.json/filters.json, core's hook docblocks as data;
  - php-stubs/wordpress-stubs: core's PHP signatures and phpdoc, for classes (and functions).
Only the names in SELECT are emitted. Each PHP type is mapped once, by `ty()`; anything it cannot
map soundly fails generation, so a drift in the pinned sources is a reviewed change.

  python3 scripts/wordpress-catalog.py           regenerate
  python3 scripts/wordpress-catalog.py --check   fail if the committed catalog differs
"""
import argparse
import hashlib
import io
import json
import re
import tarfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src/wordpress/catalog.json"
CACHE = ROOT / "tests/wp/cache/catalog"

# WordPress 7.1.x, as tests/wp/harness.sh and tests/php/wp.php boot it.
PINS = {
    "hooks": {
        "url": "https://registry.npmjs.org/@wp-hooks/wordpress-core/-/wordpress-core-1.13.0.tgz",
        "sha256": "12c0c66791f35bbb8ddf66c13538ef2e26c04366ab450f148afac2783bc1694b",
    },
    "stubs": {
        "url": "https://github.com/php-stubs/wordpress-stubs/archive/refs/tags/v7.1.2.zip",
        "sha256": "285009a92ebefe60e67c5e9a41afa8a2ee04234e1ef395c65764b869c4799a8c",
    },
}

# The curated hooks, in catalog order.
SELECT_HOOKS = [
    "init", "wp_head", "wp_footer", "wp_body_open", "wp_enqueue_scripts", "template_redirect",
    "the_content", "the_title", "the_excerpt", "excerpt_length", "excerpt_more", "body_class", "post_class",
    "save_post", "wp_insert_post", "deleted_post", "transition_post_status",
    "user_register", "wp_login", "wp_logout",
    "rest_api_init", "wp_mail", "pre_get_posts", "login_message",
]
# Classes a hook parameter may carry, as read-only views: class -> admitted public properties.
SELECT_CLASSES = {
    "WP_Post": ["ID", "post_author", "post_date", "post_date_gmt", "post_content", "post_title", "post_excerpt",
                "post_status", "comment_status", "post_name", "post_modified", "post_modified_gmt", "post_parent",
                "guid", "menu_order", "post_type", "post_mime_type", "comment_count"],
    "WP_User": ["ID", "user_login", "user_email", "user_url", "user_registered", "display_name", "user_nicename",
                "first_name", "last_name", "roles"],
}
# WP_Query is a mutable request object; only these methods are exposed, nothing else.
QUERY_METHODS = {
    "get": {"params": [{"name": "query_var", "type": "string"}], "returns": "unknown"},
    "set": {"params": [{"name": "query_var", "type": "string"}, {"name": "value", "type": "string | number | boolean | string[] | number[]"}], "returns": "void"},
    "is_main_query": {"params": [], "returns": "boolean"},
}
# Hook parameters whose documented type is a shape the docblock spells out in prose; typed here by
# hand from that docblock (the generator checks the docblock still says `array`).
SHAPES = {
    ("wp_mail", "$args"): "{ to: string | string[]; subject: string; message: string; headers: string | string[]; attachments: string | string[] }",
    ("user_register", "$userdata"): "Record<string, unknown>",
}
# Parameters the catalog refuses to pass (no sound view); the hook is still admitted with fewer args.
DROP = {("rest_api_init", "$wp_rest_server")}


def fetch(name):
    pin = PINS[name]
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / pin["url"].rsplit("/", 1)[1]
    if not path.exists():
        data = urllib.request.urlopen(pin["url"]).read()
        path.write_bytes(data)
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != pin["sha256"]:
        raise SystemExit(f"{path} does not match its pinned SHA-256 ({digest}); delete it")
    return data


def ty(php, where):
    """One PHP/phpdoc type as TypeScript, or raise."""
    parts = [p.strip() for p in php.split("|")] if isinstance(php, str) else php
    out = []
    for p in parts:
        p = p.lstrip("\\")
        if p in ("string",):
            out.append("string")
        elif p in ("int", "float", "number"):
            out.append("number")
        elif p in ("bool", "boolean"):
            out.append("boolean")
        elif p == "null":
            out.append("null")
        elif p == "string[]":
            out.append("string[]")
        elif p == "int[]":
            out.append("number[]")
        elif p in SELECT_CLASSES or p == "WP_Query":
            out.append(p)
        else:
            raise SystemExit(f"{where}: PHP type `{p}` has no sound TypeScript view; add it to SHAPES or DROP")
    return " | ".join(dict.fromkeys(out))


def hooks():
    tgz = tarfile.open(fileobj=io.BytesIO(fetch("hooks")))
    docs = {}
    for kind in ("actions", "filters"):
        for h in json.load(tgz.extractfile(f"package/hooks/{kind}.json"))["hooks"]:
            docs.setdefault(h["name"], h)
    out = {}
    for name in SELECT_HOOKS:
        h = docs.get(name) or raise_(f"hook `{name}` is not in the pinned docs")
        kind = "filter" if h["type"] == "filter" else "action"
        params, dropped = [], False
        for tag in (t for t in h["doc"]["tags"] if t["name"] == "param"):
            var = tag["variable"]
            if (name, var) in DROP:
                dropped = True
                break
            if (name, var) in SHAPES:
                if tag["types"] != ["array"]:
                    raise SystemExit(f"{name} {var}: the docblock no longer says `array`; review SHAPES")
                t = SHAPES[(name, var)]
            else:
                t = ty(tag["types"], f"{name} {var}")
            params.append({"name": var.lstrip("$"), "type": t})
        if not dropped and len(params) != h["args"]:
            raise SystemExit(f"{name}: the docblock lists {len(params)} parameters, the call passes {h['args']}")
        out[name] = {
            "kind": kind,
            "params": params,
            "description": h["doc"]["description"],
            "source": h["file"],
            # `pre_get_posts` passes its query by reference (`do_action_ref_array`): the handler
            # changes it through `set`, never by replacing it.
            "byReference": h["type"] == "action_reference",
        }
    return out


def raise_(message):
    raise SystemExit(message)


def classes():
    archive = zipfile.ZipFile(io.BytesIO(fetch("stubs")))
    stubs = archive.read("wordpress-stubs-7.1.2/wordpress-stubs.php").decode()
    out = {}
    for cls, props in SELECT_CLASSES.items():
        m = re.search(r"\n    (?:final )?class " + cls + r"\b[^\n]*\n    \{(.*?)\n    \}\n", stubs, re.S)
        if not m:
            raise SystemExit(f"class {cls} is not in the pinned stubs")
        body = m.group(1)
        head = stubs[: m.start()].rsplit("/**", 1)[-1]
        types = {}
        for var, name in re.findall(r"@var ([^\s*]+)[^\n]*\n(?:\s*\*[^\n]*\n)*?\s*\*/\s*\n\s*public \$(\w+)", body):
            types[name] = var
        for var, name in re.findall(r"@property\s+(\S+)\s+\$(\w+)", head):
            types.setdefault(name, var)
        fields = {}
        for p in props:
            if p not in types:
                raise SystemExit(f"{cls}::${p} is not a documented public property in the pinned stubs")
            fields[p] = ty(types[p], f"{cls}::${p}")
        out[cls] = fields
    out["WP_Query"] = {"$methods": QUERY_METHODS}
    return out


def render():
    return json.dumps({
        "version": 1,
        "sources": {k: v["url"] for k, v in PINS.items()},
        "classes": classes(),
        "hooks": hooks(),
    }, indent=2) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    text = render()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != text:
            parser.exit(1, "src/wordpress/catalog.json is stale; run python3 scripts/wordpress-catalog.py\n")
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(text)


if __name__ == "__main__":
    main()
