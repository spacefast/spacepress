<?php

declare(strict_types=1);

/*
 * examples/kitchen-sink on WordPress (SQLite), built by tests/kitchen_sink.rs: every compiled route
 * over HTTP, then the things a visitor, a member and the staff actually do. Reserving a seat posts
 * the page's own form, so the form's address is read from the HTML the app rendered.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

putenv('KITCHEN_REGISTRATION_SECRET=local-test-registration-key');
putenv('KITCHEN_CONTACT_TO=desk@kitchen.example');
putenv('KITCHEN_CONTACT_FROM=forms@kitchen.example');
putenv('TP_SERVICES_RATE_SECRET=' . bin2hex(random_bytes(32)));
$site = wpSite('kitchen-sink', [
    'wpContent' => $argv[1],
    'users' => ['cook' => 'subscriber', 'host' => 'editor'],
    'server' => true,
]);

/** One HTTP request to the site: [status, body, response headers]. `$as` signs in; `$jar` keeps cookies between requests. */
function visit(string $path, array $headers = [], ?string $body = null, ?string $as = null, ?string $jar = null): array
{
    global $site;
    $ch = curl_init(str_starts_with($path, 'http') ? $path : $site->url() . $path);
    $response = [];
    curl_setopt_array($ch, [
        CURLOPT_TIMEOUT => 30, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers,
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$response): int {
            if (str_contains($line, ':')) {
                [$name, $value] = explode(':', $line, 2);
                $response[strtolower($name)] = trim($value);
            }
            return strlen($line);
        },
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    if ($as !== null) {
        // One login session per user: a form's nonce belongs to the session that rendered it.
        static $sessions = [];
        $sessions[$as] ??= LOGGED_IN_COOKIE . '=' . rawurlencode(wp_generate_auth_cookie($site->userId($as), time() + 3600, 'logged_in'));
        curl_setopt($ch, CURLOPT_COOKIE, $sessions[$as]);
    }
    if ($jar !== null) {
        curl_setopt_array($ch, [CURLOPT_COOKIEFILE => $jar, CURLOPT_COOKIEJAR => $jar]);
    }
    $html = (string) curl_exec($ch);
    return [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), $html, $response];
}

/** The form on a rendered page whose button reads `$button`: where it posts, and its hidden fields. */
function form(string $html, string $button): ?array
{
    if (preg_match_all('~<form\b([^>]*)>(.*?)</form>~s', $html, $forms, PREG_SET_ORDER) === false) {
        return null;
    }
    foreach ($forms as [, $attributes, $inner]) {
        if (!str_contains($inner, '>' . $button . '</button>') || preg_match('~\baction="([^"]+)"~', $attributes, $action) !== 1) {
            continue;
        }
        preg_match_all('~<input type="hidden" name="([^"]+)" value="([^"]*)"~', $inner, $hidden, PREG_SET_ORDER);
        $fields = [];
        foreach ($hidden as [, $name, $value]) {
            $fields[$name] = html_entity_decode($value, ENT_QUOTES);
        }

        return ['action' => html_entity_decode($action[1], ENT_QUOTES), 'fields' => $fields];
    }

    return null;
}

/** Posts a page's form as a browser without JavaScript does, and returns the page it comes back to. */
function submit(string $page, string $button, array $values, string $as): array
{
    $jar = tempnam(sys_get_temp_dir(), 'ksjar');
    $form = form(visit($page, as: $as, jar: $jar)[1], $button);
    if ($form === null) {
        return [0, "no form with a \"$button\" button on $page", []];
    }
    [$status, , $response] = visit($form['action'], [], http_build_query($values + $form['fields']), $as, $jar);
    if ($status !== 303) {
        return [$status, 'the form post did not redirect', $response];
    }

    return visit($response['location'] ?? $page, as: $as, jar: $jar);
}

/** The messages a page shows after a form post: its `role="alert"` and `role="status"` paragraphs. */
function notices(string $html): array
{
    preg_match_all('~<p role="(?:alert|status)">(.*?)</p>~s', $html, $found);

    return array_map(static fn (string $text): string => html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5), $found[1]);
}

/**
 * Runs the app's jobs the requests so far queued (Action Scheduler's own runner), as WP-Cron would.
 * A job is due from the second it was queued in, so the runner is asked again until none of the
 * app's own jobs is waiting. The webhook job stays out of it: no endpoint is configured here.
 */
function drain(): void
{
    global $site;
    $waiting = static fn (): int => (int) $site->scalar("SELECT COUNT(*) FROM {prefix}tp__jobs WHERE `state` = 'pending' AND `attempts` = 0 AND `job` <> 'typedpress.webhook'");
    for ($i = 0; $i < 20 && $waiting() > 0; $i++) {
        if (ActionScheduler_QueueRunner::instance()->run('TypedPress tests') === 0) {
            usleep(250_000);
        }
    }
}

/** The queued mail, newest first, as `mail.send` normalized it. */
function mailbox(WpSite $site): array
{
    return array_map(
        static fn (array $row): array => json_decode((string) $row['input'], true)['message'],
        $site->sql("SELECT `input` FROM {prefix}tp__jobs WHERE `job` = 'typedpress.mail' ORDER BY `createdAt` DESC, `id` DESC"),
    );
}

// ---- every compiled route answers over HTTP
$paths = [
    '/' => ['/', 'Workshops'],
    'api/registration' => ['/api/registration?workshop=bread-basics', ''],
    'api/schedule' => ['/api/schedule?kitchen=annex', '"kitchen":"annex"'],
    'events/[slug]' => ['/events/bread-basics/', 'Bread basics'],
    'journal/[slug]' => ['/journal/feeding-a-starter/', 'Feeding a starter'],
    'recipes' => ['/recipes/', 'Weekday sourdough'],
    'recipes/[slug]' => ['/recipes/weekday-sourdough/', 'Serves 8'],
    'visits/[day]' => ['/visits/saturday/', 'Saturday visits'],
    'handbook' => ['/handbook/', 'Using the kitchen'],
    'handbook/[...path]' => ['/handbook/using-the-kitchen/', 'Clean as you go'],
    'about' => ['/about/', 'hands-on classes'],
    'contact' => ['/contact/', 'Contact the kitchen'],
    'cart' => ['/cart/', 'Cart'],
    'checkout' => ['/checkout/', 'wc-block-checkout'],
    'find' => ['/find/?q=bread', 'Bread basics'],
    'shop' => ['/shop/', 'Bench scraper'],
    'supplies/[slug]' => ['/supplies/bench-scraper/', 'stainless steel scraper'],
    'staff' => ['/staff/', 'Kitchen staff'],
    'kitchen.start' => ['/start/', ''],
];
$routes = array_column($site->plugin()->schema->app()['routes'], 'id');
sort($routes);
$covered = array_keys($paths);
sort($covered);
eq('every compiled route has an HTTP case', $covered, $routes);
foreach ($paths as $id => [$path, $marker]) {
    $status = match ($id) {
        'api/registration' => 401,
        'kitchen.start' => 301,
        default => 200,
    };
    [$actual, $body, $response] = visit($path, [], $id === 'api/registration' ? '{}' : null, $id === 'staff' ? 'host' : null);
    eq("$id returns $status", $actual, $status);
    if ($marker !== '') {
        check("$id renders $marker", str_contains($body, $marker), substr(strip_tags($body), 0, 300));
    }
    if ($id === 'kitchen.start') {
        eq('start redirect points to About', parse_url($response['location'] ?? '', PHP_URL_PATH), '/about/');
    }
}
eq('a guest is sent to sign-in from the staff layout', visit('/staff/')[0], 302);
eq('a subscriber cannot open the staff layout', visit('/staff/', as: 'cook')[0], 403);
[$status, $body] = visit('/events/missing/');
eq('a missing workshop returns 404', $status, 404);
check('a missing workshop uses the app 404', str_contains($body, 'Kitchen page not found'));
[$status, $prerender] = $site->call('GET', '/prerender', as: 'host');
eq('the visit page enumerates its static route', [$status, array_column($prerender['urls'] ?? [], 'path')], [200, ['/visits/saturday']]);

// ---- sign-in: the app's login component, with the notice tp/wp-hooks/login_message.ts adds
[$status, $body] = visit('/wp-login.php');
eq('WordPress login renders', $status, 200);
check('WordPress uses the app login component', str_contains($body, 'Sign in to the Community Kitchen'));
check('the login_message hook adds its escaped notice', str_contains($body, 'sign in to reserve seats') && str_contains($body, 'title="About TypedPress test site"'), $body);

// ---- the home page: its client component, and the layout's assets
[, $home] = visit('/');
check('the workshop board is a client component with its ref attached', str_contains($home, 'data-wp-interactive="kitchen-sink/WorkshopBoard"') && str_contains($home, 'data-tp-ref="toggle"'));
check('the board uses its CSS module classes', str_contains($home, 'class="WorkshopBoard_board"'));
check('the layout places the imported SVG and links the feed', preg_match('~<img src="[^"]+/whisk-[0-9a-f]+\.svg"~', $home) === 1 && str_contains($home, 'application/rss+xml'));

// ---- synced content: fields, the taxonomy, the plugin package's hook and the WordPress hook
[, $workshop] = visit('/events/bread-basics/');
foreach (['Hosted by <a href="https://example.com/mina">Mina Okafor</a>', '<li>Bread flour · 500 g</li>', '<h2>Bring a jar</h2>', '<cite>Mina Okafor</cite>', 'Bring: apron, scale'] as $part) {
    check("the workshop page renders $part", str_contains($workshop, $part));
}
check('the workshop renders its live region, and its comment form for a member', str_contains($workshop, 'data-tp-live="registration"')
    && str_contains(visit('/events/bread-basics/', as: 'cook')[1], 'typedpress-comments-form'));
check('a guest is offered sign-in, with the workshop to come back to', preg_match('~href="[^"]*wp-login\.php\?redirect_to=[^"]*events%2Fbread-basics~', $workshop) === 1 && !str_contains($workshop, 'Reserve seats'));
[, $recipes] = visit('/recipes/');
check('the recipe list shows servings and the recipe\'s topic', str_contains($recipes, 'serves 8') && preg_match('~<span class="kitchen-topic" style="border-color:\s*#7a3b12;?">Bread</span>~', $recipes) === 1, $recipes);
[, $recipe] = visit('/recipes/weekday-sourdough/');
check('the plugin package\'s beforeCreate hook wrote the allergen notice', str_contains($recipe, '<p role="note">Made in a kitchen that handles nuts, wheat and dairy.</p>'), substr(strip_tags($recipe), 0, 400));
[$status, $feed] = visit('/feed/');
check('the journal feed ends its excerpt with the excerpt_more hook', $status === 200 && str_contains($feed, 'keep reading on the journal.'), [$status, substr($feed, 0, 600)]);
[, $schedule] = visit('/api/schedule');
$listed = json_decode($schedule, true)['workshops'][0] ?? [];
eq('the schedule feed gives plain text and an absolute link', [$listed['title'] ?? null, $listed['summary'] ?? null, parse_url($listed['url'] ?? '', PHP_URL_PATH)],
    ['Bread basics', 'Mix, shape, and bake a loaf with the community kitchen.', '/events/bread-basics/']);

// ---- the shop: Woo's own links reach the product page, the cart holds a line, checkout is the block
[, $shop] = visit('/shop/');
check('the shop links each product to its page', str_contains($shop, '/supplies/bench-scraper/'));
preg_match('~href="([^"]*add-to-cart=\d+)"~', $shop, $add);
$basket = tempnam(sys_get_temp_dir(), 'kscart');
visit(html_entity_decode($add[1] ?? '/cart/', ENT_QUOTES), jar: $basket);
[$status, $cart] = visit('/cart/', jar: $basket);
check('the cart holds a line for the product', $status === 200 && str_contains($cart, 'woocommerce-cart-form__cart-item') && str_contains($cart, 'Bench scraper'), substr(strip_tags($cart), 0, 400));
preg_match('~class="product-name"[^>]*>\s*<a href="([^"]+)"~', $cart, $line);
eq('the cart line links to the product page, which exists', [parse_url($line[1] ?? '', PHP_URL_PATH), visit($line[1] ?? '/missing/')[0]], ['/supplies/bench-scraper/', 200]);
[$status, $checkout] = visit('/checkout/', jar: $basket);
check('checkout renders WooCommerce\'s Checkout block', $status === 200 && str_contains($checkout, 'wc-block-checkout') && str_contains($checkout, 'data-block-name="woocommerce/checkout"'), substr(strip_tags($checkout), 0, 300));

$eventId = (int) $site->scalar("SELECT ID FROM {prefix}posts WHERE post_name = 'bread-basics'");

// ---- reserving a seat, on a fresh site: the page's form, the reservation code, the mail
[$status, $refused] = submit('/events/bread-basics/', 'Reserve seats', ['seats' => 2, 'email' => 'someone-else@example.test'], 'cook');
eq('the form takes no address to mail: a typed one is refused, and nothing is reserved or sent',
    [$status, notices($refused), (int) $site->scalar('SELECT COUNT(*) FROM {prefix}tp_registrations'), count(mailbox($site))], [200, ["Unknown field 'email'"], 0, 0]);
[$status, $booked] = submit('/events/bread-basics/', 'Reserve seats', ['seats' => 2, 'allergies' => 'nuts, <b>dairy</b>'], 'cook');
$mine = $site->sql('SELECT `code`, `seats`, `preferences` FROM {prefix}tp_registrations WHERE `memberId` = ?', [$site->userId('cook')])[0] ?? null;
check('a subscriber reserves seats through the form', $status === 200 && $mine !== null && (int) $mine['seats'] === 2
    && preg_match('/\A[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\z/', (string) $mine['code']) === 1, [$status, $mine, notices($booked)]);
check('the page shows the reservation code', $mine !== null && str_contains($booked, 'Reservation code: ' . $mine['code']) && str_contains($booked, 'A confirmation is on its way'));
eq('the allergies are stored as plain text', json_decode((string) ($mine['preferences'] ?? 'null'), true), ['allergens' => ['nuts', 'dairy']]);
$sent = mailbox($site)[0] ?? [];
eq('the confirmation goes to the account\'s own address, from the local default sender',
    [$sent['to'] ?? null, $sent['from'] ?? null, array_key_exists('replyTo', $sent), $sent['subject'] ?? null],
    [[['email' => 'cook@example.test', 'name' => 'cook']], ['email' => \TypedPress\Mail::LOCAL_SENDER], false, 'Reservation for Bread basics']);
check('the mail is the React Email template, as HTML and text, with the code and the workshop link', $mine !== null
    && str_contains($sent['html'] ?? '', $mine['code']) && str_contains($sent['html'] ?? '', '/events/bread-basics/')
    && str_contains($sent['text'] ?? '', "Your booking code is {$mine['code']}."), $sent);
drain();
eq('the mail job hands the message to WordPress', $site->scalar("SELECT `state` FROM {prefix}tp__jobs WHERE `job` = 'typedpress.mail' ORDER BY `createdAt` DESC, `id` DESC"), 'done');
[$status, $problem] = $site->call('POST', '/actions/bookSeats', ['eventId' => $eventId, 'seats' => 1], as: 'cook');
eq('a second reservation for the same workshop is a 409', [$status, $problem['code'] ?? null], [409, 'already_registered']);
eq('nothing is mailed for the refused reservation', count(mailbox($site)), 1);

// ---- the kitchen's own sender and reply address, from the settings global
[$status] = $site->call('PATCH', '/globals/settings', ['mailFrom' => 'bookings@kitchen.example', 'replyTo' => 'hello@kitchen.example',
    'links' => [['label' => 'Newsletter', 'href' => 'https://example.com/newsletter']]], as: 'admin');
eq('an admin saves the kitchen settings', $status, 200);
[$status, $second] = submit('/events/bread-basics/', 'Reserve seats', ['seats' => 1], 'subscriber');
$sent = mailbox($site)[0] ?? [];
eq('the next confirmation uses them', [$status, $sent['to'][0]['email'] ?? null, $sent['from'] ?? null, $sent['replyTo'] ?? null],
    [200, 'subscriber@example.test', ['email' => 'bookings@kitchen.example', 'name' => 'Community Kitchen'], ['email' => 'hello@kitchen.example']]);
check('the layout lists the settings\' links', str_contains($second, '<a href="https://example.com/newsletter">Newsletter</a>'));
check('a member reads only their own reservation', !str_contains($second, (string) ($mine['code'] ?? 'no code')) && str_contains($second, 'You hold 1 seat(s)'));

// ---- cancelling: db.delete, through the page's other form
[$status, $cancelled] = submit('/events/bread-basics/', 'Cancel my reservation', [], 'subscriber');
check('a member cancels their reservation', $status === 200 && notices($cancelled) === ['Your reservation of 1 seat(s) is cancelled.'], [$status, notices($cancelled) ?: $cancelled]);
eq('the cancelled reservation is soft-deleted',
    [(int) $site->scalar('SELECT COUNT(*) FROM {prefix}tp_registrations WHERE `_live` = 1'), (int) $site->scalar('SELECT COUNT(*) FROM {prefix}tp_registrations WHERE `deletedAt` IS NOT NULL')],
    [1, 1]);

// ---- media and the private handout on the workshop page
$png = tempnam(sys_get_temp_dir(), 'kspng');
$image = imagecreatetruecolor(900, 600);
imagepng($image, $png);
$picture = static function (string $name) use ($site, $png): array {
    // An upload moves its file, so each one gets its own copy.
    copy($png, $copy = tempnam(sys_get_temp_dir(), 'ksup'));

    return $site->call('POST', '/media', as: 'host', files: ['file' => ['name' => $name, 'tmp_name' => $copy, 'error' => UPLOAD_ERR_OK, 'size' => filesize($copy)]], form: ['alt' => 'A loaf'])[1];
};
$poster = $picture('poster.png');
$shot = $picture('crumb.png');
$pdf = tempnam(sys_get_temp_dir(), 'kspdf');
file_put_contents($pdf, "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
[$status, $handout] = $site->call('POST', '/files/handouts', as: 'host', files: ['file' => ['name' => 'bread-basics.pdf', 'tmp_name' => $pdf, 'error' => UPLOAD_ERR_OK, 'size' => filesize($pdf)]]);
eq('an editor uploads a handout to the private bucket', [$status, $handout['filename'] ?? null], [201, 'bread-basics.pdf']);
[$status] = $site->call('PATCH', "/events/$eventId", ['poster' => $poster['id'], 'gallery' => [$shot['id']], 'handout' => $handout['id'], 'format' => 'demo', 'demoUrl' => 'https://example.com/demo'], as: 'host');
eq('the workshop takes a poster, a gallery, a handout and a demo link', $status, 200);
[, $withFiles] = visit('/events/bread-basics/', as: 'cook');
check('the poster renders at the card size the config declares', str_contains($withFiles, '<img class="workshop_poster" src="' . ($poster['sizes']['card']['url'] ?? 'no card size') . '" alt="A loaf"'), $poster['sizes'] ?? $poster);
check('the gallery renders its picture', str_contains($withFiles, '<ul class="workshop_gallery"><li><img src="' . ($shot['sizes']['card']['url'] ?? 'no card size') . '"'));
check('a demonstration links to its recording', str_contains($withFiles, '<a href="https://example.com/demo">Watch the demonstration</a>') && str_contains($withFiles, 'Demonstration'));
preg_match('~<a href="([^"]+)">Download the handout \(bread-basics\.pdf\)</a>~', $withFiles, $link);
check('a signed-in member gets a signed link to the handout', preg_match('~/files/handouts/' . $handout['id'] . '/download\?exp=\d+&sig=~', html_entity_decode($link[1] ?? '', ENT_QUOTES)) === 1, $link[1] ?? substr($withFiles, (int) strpos($withFiles, '<article'), 1500));
check('a guest gets no handout link', !str_contains(visit('/events/bread-basics/')[1], 'Download the handout'));
[$status, $problem] = $site->call('PATCH', "/events/$eventId", ['demoUrl' => 'http://example.com/demo'], as: 'host');
eq('the demo link\'s validate() refuses plain http', [$status, $problem['pointer'] ?? null, $problem['detail'] ?? null], [422, '/demoUrl', 'Link to the demo over https.']);

// ---- the contact page: a client component posting to the native services form
[, $contact] = visit('/contact/');
check('the contact form is a client component that knows the form\'s endpoint', preg_match('~data-wp-interactive="kitchen-sink/ContactForm" data-wp-context="([^"]+)"~', $contact, $island) === 1
    && str_ends_with(json_decode(html_entity_decode($island[1], ENT_QUOTES), true)['endpoint'] ?? '', '/services/forms/contact'), $island[1] ?? $contact);
$endpoint = json_decode(html_entity_decode($island[1] ?? '{}', ENT_QUOTES), true)['endpoint'] ?? '';
$message = json_encode(['website' => '', 'data' => ['email' => 'visitor@example.test', 'message' => 'Do you run classes for children?']]);
[$status, $receipt] = visit($endpoint, ['Content-Type: application/json', 'Idempotency-Key: kitchen-contact-1'], $message);
$received = json_decode($receipt, true)['data'] ?? [];
[$status2, $saved] = $site->call('GET', '/services/submissions/' . ($received['id'] ?? 0), as: 'host');
eq('a visitor\'s message is saved for the staff to read, and its notification queued',
    [$status, $received['delivery'] ?? null, $status2, $saved['body']['message'] ?? null], [201, 'queued', 200, 'Do you run classes for children?']);
[$status, $problem] = visit($endpoint, ['Content-Type: application/json', 'Idempotency-Key: kitchen-contact-2'], json_encode(['website' => '', 'data' => ['email' => 'not-an-address', 'message' => 'Hi']]));
eq('the form refuses a bad address', [$status, json_decode($problem, true)['code'] ?? null], [422, 'invalid_input']);

// ---- collection hooks, the job they queue, and the staff tools that show the result
[$status, $class] = $site->call('POST', '/events', ['title' => '  Knife skills  ', 'startsOn' => '2020-03-01', 'registrationOpen' => false, 'status' => 'published'], as: 'host');
eq('beforeCreate trims the title', [$status, $class['title'] ?? null], [201, 'Knife skills']);
drain();
eq('afterCreate queued the job, which ran once: the option and the log entry', [(bool) get_option('kitchen_has_workshops'),
    (int) $site->scalar('SELECT COUNT(*) FROM {prefix}tp_activity WHERE `eventId` = ? AND `message` = ?', [$class['id'], 'Workshop created'])], [true, 1]);
eq('afterPublish logs the publication', (int) $site->scalar('SELECT COUNT(*) FROM {prefix}tp_activity WHERE `eventId` = ? AND `message` = ?', [$class['id'], 'Workshop published']), 1);
[$status, $problem] = $site->call('PATCH', "/events/{$class['id']}", ['registrationOpen' => true], as: 'host');
eq('beforeUpdate refuses to reopen a past workshop', [$status, $problem['code'] ?? null], [409, 'workshop_over']);
$body = '{"desk":"front"}';
[$status] = visit('/api/registration?workshop=' . rawurlencode('Bread Basics'), ['x-kitchen-signature: ' . hash_hmac('sha256', $body, 'local-test-registration-key'), 'Content-Type: application/json'], $body);
eq('the signed route closes registration, finding the workshop by its title', [$status, (bool) get_post_meta($eventId, 'tp_registrationOpen', true)], [204, false]);
eq('afterUpdate logs the closing', (int) $site->scalar('SELECT COUNT(*) FROM {prefix}tp_activity WHERE `eventId` = ? AND `message` = ?', [$eventId, 'Registration closed']), 1);
[$status, $problem] = $site->call('DELETE', "/events/$eventId", as: 'admin');
eq('beforeDelete keeps a workshop that has reservations', [$status, $problem['code'] ?? null, get_post($eventId) !== null], [409, 'has_registrations', true]);
eq('an admin deletes a workshop that has none', $site->call('DELETE', "/events/{$class['id']}", as: 'admin')[0], 200);
eq('afterDelete logs the deletion, and the log keeps its rows without the workshop',
    $site->sql('SELECT `eventId`, `message` FROM {prefix}tp_activity WHERE `message` LIKE ?', ['Workshop deleted%']), [['eventId' => null, 'message' => 'Workshop deleted: Knife skills']]);
$aliasRows = \TypedPress\Db::instance()->findMany('activity', ['where' => ['message' => 'Workshop published']]);
eq('column alias works in where filters and returns the canonical field name', $aliasRows[0]['summary'] ?? null, 'Workshop published');
eq('the deleted workshop\'s earlier entries stay, unlinked', (int) $site->scalar('SELECT COUNT(*) FROM {prefix}tp_activity WHERE `eventId` IS NULL'), 3);

[$status, $staff] = submit('/staff/', 'Check the schedule', [], 'host');
check('the staff form calls the workshops Ability and shows its answer', $status === 200 && preg_match('~\A0 workshop\(s\) open for registration · times in \S+\z~', notices($staff)[0] ?? '') === 1, [$status, notices($staff)]);
[$status, $posted] = submit('/staff/', 'Post announcement', ['announcement' => 'Closed on <b>Monday</b> for cleaning.'], 'host');
check('an editor posts an announcement, saved as plain text', $status === 200 && notices($posted) === ['The announcement is up.'], [$status, notices($posted)]);
check('every page shows the announcement', str_contains(visit('/about/')[1], '<p>Closed on Monday for cleaning.</p>'));
check('the staff page lists the kitchen log', str_contains($staff, 'Registration closed · Bread basics') && str_contains($staff, 'Workshop deleted: Knife skills'));
check('the staff page renders the API reference', str_contains($staff, '<summary>API operations</summary>') && preg_match('~<code>GET [^<]*/events</code>~', $staff) === 1);
check('an editor has no link to the site settings', !str_contains($staff, 'options-general.php') && str_contains(visit('/staff/', as: 'admin')[1], 'options-general.php'));
[$status, $again] = $site->call('POST', '/actions/scheduleAgain', ['id' => $eventId], as: 'host');
eq('the schedule screen copies a workshop to the next week as a draft', [$status, $again['startsOn'] ?? null, get_post_status((int) ($again['id'] ?? 0))], [200, '2027-01-22', 'draft']);
check('the staff page counts the draft through the kind\'s system API', str_contains(visit('/staff/', as: 'host')[1], '1 draft workshop(s) waiting for review.'));
eq('only an admin cancels a workshop (soft-delete to trash); the delete hooks keep one that has reservations',
    [$site->call('POST', '/actions/cancelWorkshop', ['id' => $again['id'] ?? 0], as: 'host')[0], $site->call('POST', '/actions/cancelWorkshop', ['id' => $again['id'] ?? 0], as: 'admin')[0],
        get_post_status((int) ($again['id'] ?? 0)), $site->call('POST', '/actions/cancelWorkshop', ['id' => $eventId], as: 'admin')[1]['code'] ?? null],
    [403, 200, 'trash', 'has_registrations']);
eq('an admin can restore and then permanently purge a soft-deleted workshop',
    [$site->call('POST', '/actions/restoreWorkshop', ['id' => $again['id'] ?? 0], as: 'admin')[0], get_post_status((int) ($again['id'] ?? 0)),
        $site->call('POST', '/actions/purgeWorkshop', ['id' => $again['id'] ?? 0], as: 'admin')[0], get_post((int) ($again['id'] ?? 0))],
    [200, 'draft', 200, null]);
// Native revisions + table _rev optimistic concurrency end-to-end on real WordPress:
[$status, $hist] = $site->call('POST', '/actions/workshopHistory', ['id' => $eventId], as: 'host');
check('workshopHistory exercises kind.revisions.{list,get,diff} on real WordPress',
    $status === 200 && ($hist['count'] ?? 0) >= 2 && ($hist['firstTitle'] ?? '') === 'Bread basics' && is_array($hist['diff']['changes'] ?? null),
    [$status, $hist]);
[$status, $actRow] = $site->call('GET', '/activity', as: 'host', query: ['limit' => '1']);
$actId = $actRow[0]['id'] ?? 0;
$actRev = $actRow[0]['_rev'] ?? '';
check('table() rows carry _rev token on REST reads', $status === 200 && $actId > 0 && is_string($actRev) && $actRev !== '', [$status, $actRow[0] ?? null]);
[$s1, $u1] = $site->call('PATCH', "/activity/$actId", ['summary' => 'Updated once', '_rev' => $actRev], as: 'admin');
[$s2, $u2] = $site->call('PATCH', "/activity/$actId", ['summary' => 'Stale write', '_rev' => $actRev], as: 'admin');
eq('table() PATCH accepts fresh _rev and refuses stale _rev with 409 stale_revision',
    [$s1, $u1['summary'] ?? null, $s2, $u2['code'] ?? null],
    [200, 'Updated once', 409, 'stale_revision']);
[$s3, $tRevs] = $site->call('GET', "/activity/$actId/revisions", as: 'admin');
[$s4, $tDiff] = $site->call('GET', "/activity/$actId/revisions/diff", as: 'admin', query: ['from' => '1', 'to' => '2']);
check('table() exposes /revisions and /revisions/diff over REST',
    $s3 === 200 && count($tRevs) >= 2 && $s4 === 200 && array_column($tDiff['changes'] ?? [], 'field') === ['summary'],
    [$s3, $tRevs, $s4, $tDiff]);
[$status, $recap] = $site->call('POST', '/actions/draftRecap', ['id' => $eventId], as: 'host');
eq('the schedule screen\'s recap action drafts a WordPress post', [$status, $recap['title'] ?? null, $recap['status'] ?? null, get_post_type((int) ($recap['postId'] ?? 0))], [200, 'Recap: Bread basics', 'draft', 'post']);

// ---- the app's MCP server
$mcp = '/wp-json/mcp/typedpress-kitchen-sink';
$headers = ['Authorization: Basic ' . base64_encode($site->appPassword('admin')),
    'Content-Type: application/json', 'Accept: application/json, text/event-stream'];
[$status, , $init] = visit($mcp, $headers, json_encode(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'initialize',
    'params' => ['protocolVersion' => '2025-11-25', 'capabilities' => new stdClass(), 'clientInfo' => ['name' => 'test', 'version' => '1']]]));
eq('the app MCP server accepts a session', $status, 200);
[$status, $body] = visit($mcp, [...$headers,
    'Mcp-Session-Id: ' . ($init['mcp-session-id'] ?? ''), 'Mcp-Protocol-Version: 2025-11-25',
], json_encode(['jsonrpc' => '2.0', 'id' => 2, 'method' => 'tools/list', 'params' => new stdClass()]));
eq('the app MCP server answers', $status, 200);
check('the app exposes the workshop schedule to MCP', str_contains($body, 'kitchen-sink-upcoming'));

// ---- a page that throws renders tp/app/error.tsx with a 500 (last: it breaks the log's table)
$site->exec('DROP TABLE {prefix}tp_activity');
[$status, $body] = visit('/staff/', as: 'host');
check('a failing page answers 500 with the app\'s error page', $status === 500 && str_contains($body, 'The kitchen page could not load') && !str_contains($body, 'tp_activity'), [$status, substr(strip_tags($body), 0, 300)]);
finish('kitchen_sink');
