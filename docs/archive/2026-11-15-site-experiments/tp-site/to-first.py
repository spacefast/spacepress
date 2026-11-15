"""Turn the built guide (index.html, guide.js, the two pierre stylesheets) into a First app.

    python3 -I to-first.py <built-guide-dir> <first-project-dir>

Each built page becomes a First route (/ and /play): its body is one trusted literal in a page.tsx, its
own stylesheet a .css file that page imports, and the scripts, library stylesheets, compiler and example
files go to public/.
"""
import json, pathlib, re, shutil, sys

built, project = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])


def read(name):
    """One built page as (title, description, css, body, script modules)."""
    page = (built / name).read_text(encoding="utf-8")
    head = page[: page.index("</head>")]
    css = re.search(r"<style>(.*?)</style>", head, re.S).group(1)
    title = re.search(r"<title>(.*?)</title>", head).group(1)
    description = re.search(r'<meta name="description" content="([^"]*)"', head).group(1)
    body = page[page.index("<body") :]
    body = body[body.index(">") + 1 : body.rindex("</body>")]
    # The page's script modules load through `metadata.scripts`, from public/.
    scripts = re.findall(r'<script type="module" src="([^"]+)"></script>', body)
    body = re.sub(r'<script type="module" src="[^"]+"></script>', "", body)
    # Every address is from the site root: a First page is not a file beside its assets.
    body = re.sub(r'href="((?:pierre-[\w-]+)\.css)"', r'href="/\1"', body)
    body = re.sub(r'href="(play(?:\?[^"]*)?)"', r'href="/\1"', body).replace('href="./"', 'href="/"')
    body = re.sub(r'data-(wasm|examples)="([^"/][^"]*)"', r'data-\1="/\2"', body)
    return title, description, css, body, ["/" + s for s in scripts]


def scoped(css, name):
    """The page's stylesheet nested under First's page class plus the page's own.

    The theme's global styles load after the app's stylesheets, so a bare `a { }` or `body { }` loses to
    them; `body.first-app` outranks the theme's `:where()` selectors. `:root` stays outside.
    """
    root = re.search(r":root\s*\{[^}]*\}", css)
    css, bodies = re.subn(r"(?m)^(\s*)body \{", r"\1& {", css.replace(root.group(0), ""))
    assert bodies >= 1, f"{name}: expected a body rule"
    return f"{root.group(0)}\nbody.first-app:has(.tp-{name}) {{\n{css}\n}}\n"


def page(directory, name, component, source):
    title, description, css, body, scripts = read(source)
    literal = body.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{name}.css").write_text(scoped(css, name), encoding="utf-8")
    (directory / "page.tsx").write_text(
        f'import {{ Html }} from "first/app";\nimport "./{name}.css";\n\n'
        f"export const metadata = {{\n  title: {json.dumps(title)},\n  description: {json.dumps(description)},\n"
        f"  scripts: {json.dumps(scripts)},\n}};\n\n"
        f"export default function {component}() {{\n  return (\n    <div className=\"tp-{name}\">\n      <Html value={{`{literal}`}} />\n    </div>\n  );\n}}\n",
        encoding="utf-8",
    )
    print(f"{source}: {len(literal)} bytes of page, {len(css)} of css, scripts {scripts}")


app = project / "first/app"
page(app, "guide", "Guide", "index.html")
page(app / "play", "play", "Playground", "play.html")
(app / "layout.tsx").write_text(
    'import type { LayoutProps } from "first/app";\n\n'
    "export default function Root({ children }: LayoutProps) {\n  return <>{children}</>;\n}\n",
    encoding="utf-8",
)
(app / "site.css").unlink(missing_ok=True)
if not (project / "first.config.ts").exists():
    (project / "first.config.ts").write_text(
        'import { defineConfig } from "first";\n\nexport default defineConfig({ name: "site", output: "static" });\n', encoding="utf-8"
    )
public = project / "public"
shutil.rmtree(public, ignore_errors=True)
public.mkdir()
for file in built.iterdir():
    # The two pages are First routes now; `_headers` is a rule file for a static host, not a public file.
    if file.name in ("index.html", "play.html", "_headers") or file.name.startswith("."):
        continue
    if file.is_dir():
        shutil.copytree(file, public / file.name)
    else:
        shutil.copyfile(file, public / file.name)
