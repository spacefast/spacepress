"""What a site owner's browser does in wp-admin, for tests/wp/plugin/run.sh: sign in, submit the
forms a page shows, and print a screen's text. One cookie jar per run; standard library only."""
import html, http.cookiejar, json, re, sys, urllib.parse, urllib.request, uuid

jar_path, base = sys.argv[1], sys.argv[2].rstrip("/")
jar = http.cookiejar.MozillaCookieJar(jar_path)
try:
    jar.load(ignore_discard=True)
except FileNotFoundError:
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect)


def request(url, data=None, headers=None, follow=True):
    """(status, final url, body, location). Redirects are followed by hand so cookies are kept."""
    for _ in range(8):
        req = urllib.request.Request(url, data=data, headers=headers or {})
        try:
            response = opener.open(req, timeout=300)
            status, body, location = response.status, response.read().decode("utf-8", "replace"), None
        except urllib.error.HTTPError as error:
            status, body, location = error.code, error.read().decode("utf-8", "replace"), error.headers.get("Location")
        jar.save(ignore_discard=True)
        if location and follow and 300 <= status < 400:
            url, data, headers = urllib.parse.urljoin(url, location), None, None
            continue
        return status, url, body, location
    raise SystemExit("too many redirects")


def form(page, marker):
    """The fields of the form that contains `marker`, as a list of (name, value)."""
    at = page.find(marker)
    if at < 0:
        raise SystemExit(f"no form with {marker!r} on the page")
    block = page[page.rfind("<form", 0, at):page.find("</form>", at)]
    fields = []
    for tag in re.findall(r"<input[^>]*>", block):
        name, value, kind = (re.search(rf'{attr}="([^"]*)"', tag) for attr in ("name", "value", "type"))
        if name and (kind is None or kind.group(1) in ("hidden", "text")):
            fields.append((name.group(1), html.unescape(value.group(1)) if value else ""))
    return fields


def text(page, start):
    """A screen's text from `start` on: table cells joined by ' | ', one row or paragraph per line."""
    at = page.find(start)
    if at < 0:
        raise SystemExit(f"the page has no {start!r}")
    body = re.sub(r"<script.*?</script>|<style.*?</style>", "", page[at:], flags=re.S)
    body = re.sub(r"</t[hd]>", " | ", body)
    body = re.sub(r"<(tr|/h\d|/p|/pre|/form|br)[^>]*>", "\n", body)
    lines = (re.sub(r"\s+", " ", line).strip() for line in html.unescape(re.sub(r"<[^>]+>", "", body)).splitlines())
    return "\n".join(line for line in lines if line)


command, args = sys.argv[3], sys.argv[4:]
if command == "login":
    request(f"{base}/wp-login.php")
    status, url, _, _ = request(f"{base}/wp-login.php", urllib.parse.urlencode({
        "log": args[0], "pwd": args[1], "wp-submit": "Log In", "testcookie": "1", "redirect_to": f"{base}/wp-admin/"}).encode())
    if "/wp-admin/" not in url:
        raise SystemExit(f"sign-in as {args[0]} ended at {url} ({status})")
elif command == "upload-plugin":
    # Plugins, Add Plugin, Upload Plugin: the form, then the Activate link on its result page.
    _, _, page, _ = request(f"{base}/wp-admin/plugin-install.php?tab=upload")
    fields = form(page, 'name="pluginzip"')
    boundary = uuid.uuid4().hex
    body = b"".join(f'--{boundary}\r\nContent-Disposition: form-data; name="{n}"\r\n\r\n{v}\r\n'.encode() for n, v in fields)
    body += f'--{boundary}\r\nContent-Disposition: form-data; name="pluginzip"; filename="first.zip"\r\nContent-Type: application/zip\r\n\r\n'.encode()
    body += open(args[0], "rb").read() + f"\r\n--{boundary}--\r\n".encode()
    status, _, page, _ = request(f"{base}/wp-admin/update.php?action=upload-plugin", body, {"Content-Type": f"multipart/form-data; boundary={boundary}"})
    link = re.search(r'href="([^"]*plugins\.php\?action=activate[^"]*)"', page)
    if not link:
        raise SystemExit(f"the upload did not install the plugin ({status}): {text(page, 'wpbody-content')[:400]}")
    status, url, page, _ = request(urllib.parse.urljoin(f"{base}/wp-admin/", html.unescape(link.group(1))))
    if "activate=true" not in url:
        raise SystemExit(f"activating ended at {url} ({status}): {text(page, 'wpbody-content')[:400]}")
elif command == "rest":
    # A REST request as the signed-in browser makes it: the login cookie, and optionally the REST
    # nonce wp-admin's scripts send. Prints the status, then the body.
    # `rest <METHOD> <url> <nonce or ""> <JSON body or ""> [Header: value]...`
    headers = dict(pair.split(": ", 1) for pair in args[4:])
    if args[2]:
        headers["X-WP-Nonce"] = args[2]
    body = (args[3] or "{}").encode() if args[0] != "GET" else None
    req = urllib.request.Request(args[1], data=body, method=args[0], headers={"Content-Type": "application/json", **headers})
    try:
        response = opener.open(req, timeout=300)
        print(response.status)
        print(response.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as error:
        print(error.code)
        print(error.read().decode("utf-8", "replace"))
elif command == "nonce":
    # The REST nonce wp-admin gives this session's scripts.
    _, _, page, _ = request(f"{base}/wp-admin/admin-ajax.php?action=rest-nonce")
    print(page.strip())
elif command == "get":
    # A wp-admin page's HTML, signed in.
    status, _, page, _ = request(f"{base}/wp-admin/{args[0]}")
    print(page)
elif command == "screen":
    # A wp-admin screen as text, from the marker on.
    status, _, page, _ = request(f"{base}/wp-admin/{args[0]}")
    print(status)
    print(text(page, args[1]))
elif command == "press":
    # Press a button on a wp-admin screen: submit the form that contains `marker`, with extra fields.
    _, url, page, _ = request(f"{base}/wp-admin/{args[0]}")
    fields = form(page, args[1]) + [tuple(pair.split("=", 1)) for pair in args[2:]]
    action = re.search(r'action="([^"]*)"', page[page.rfind("<form", 0, page.find(args[1])):])
    target = urllib.parse.urljoin(url, html.unescape(action.group(1))) if action and action.group(1) else url
    status, url, page, location = request(target, urllib.parse.urlencode(fields).encode(), follow=len(args) < 3 or args[2] != "--no-follow")
    print(json.dumps({"status": status, "url": url, "location": location}))
elif command == "approve":
    # Core's Authorize Application screen: press "Yes, I approve of this connection". Prints the
    # address WordPress sends the browser to, which is the command line's local callback.
    _, _, page, _ = request(args[0])
    fields = form(page, 'value="authorize_application_password"') + [("approve", "Yes, I approve of this connection")]
    status, _, page, location = request(f"{base}/wp-admin/authorize-application.php", urllib.parse.urlencode(fields).encode(), follow=False)
    if not location:
        raise SystemExit(f"approving did not redirect ({status}): {text(page, 'wpbody-content')[:400]}")
    print(location)
else:
    raise SystemExit(f"unknown command {command}")
