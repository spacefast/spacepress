<?php

declare(strict_types=1);

namespace Zero\Identity;

final class Plugin
{
    /** Equal to the zero-runtime version built alongside it (`Runtime::identity()` compares them). */
    public const VERSION = "0.2.0";
    public static DB $db;
    public static Accounts $accounts;
    public static Sessions $sessions;
    public static Security $security;
    public static Api $api;
    public static function boot(string $file): void
    {
        global $wpdb;
        self::$db = new DB($wpdb);
        self::$security = new Security(self::$db);
        self::$accounts = new Accounts(self::$db, self::$security);
        self::$sessions = new Sessions(self::$db, self::$security);
        self::$api = new Api(
            self::$db,
            self::$accounts,
            self::$sessions,
            self::$security,
            new Mfa(self::$db, self::$security),
        );
        if ((int) get_option("zero_identity_schema_version", 0) < Schema::VERSION) {
            Schema::migrate(self::$db);
        }
        add_action("rest_api_init", [self::$api, "register"]);
        add_filter(
            "rest_pre_serve_request",
            static function ($served, $result, $request) {
                if (
                    str_starts_with(
                        $request->get_route(),
                        "/zero-identity/v1/",
                    )
                ) {
                    header_remove("Access-Control-Allow-Origin");
                    header_remove("Access-Control-Allow-Credentials");
                    header("Vary: Origin", false);
                    self::cors(true);
                }
                return $served;
            },
            20,
            3,
        );
        add_action("template_redirect", fn() => self::page($file), 0);
        add_filter(
            "admin_body_class",
            static fn($classes) => $classes .
                (($_GET["page"] ?? "") === "zero-identity"
                    ? " zi-admin-screen"
                    : ""),
        );
        add_action("admin_menu", static function () use ($file) {
            add_menu_page(
                "Identity",
                "Identity",
                "manage_options",
                "zero-identity",
                fn() => self::adminPage($file),
                "dashicons-admin-users",
                3,
            );
        });
        add_filter(
            "authenticate",
            static function ($user, $login, $password) {
                if (
                    $user instanceof \WP_User ||
                    !is_string($login) ||
                    !is_email($login)
                ) {
                    return $user;
                }
                if (
                    is_wp_error($user) &&
                    array_diff($user->get_error_codes(), [
                        "invalid_username",
                        "invalid_email",
                        "incorrect_password",
                    ])
                ) {
                    return $user;
                }
                try {
                    $uid = self::$accounts->owner($login);
                } catch (Failure $e) {
                    return $user;
                }
                $account = $uid ? get_userdata($uid) : false;
                return $account
                    ? wp_authenticate_username_password(
                        null,
                        $account->user_login,
                        $password,
                    )
                    : $user;
            },
            21,
            3,
        );
        add_filter(
            "authenticate",
            static function ($user) {
                if ($user instanceof \WP_User) {
                    $row = self::$db->row(
                        "SELECT status FROM " .
                            self::$db->prefix .
                            "accounts WHERE wp_user_id=%d",
                        $user->ID,
                    );
                    if ($row && $row["status"] !== "active") {
                        return new \WP_Error(
                            "account_unavailable",
                            "This account is unavailable.",
                        );
                    }
                }
                return $user;
            },
            100,
        );
        add_filter(
            "wp_authenticate_user",
            static function ($user) {
                if (
                    $user instanceof \WP_User &&
                    (new Mfa(self::$db, self::$security))->enabled(
                        (int) $user->ID,
                    )
                ) {
                    return new \WP_Error(
                        "identity_mfa_required",
                        "Use the Identity sign-in page to complete multifactor authentication.",
                    );
                }
                return $user;
            },
            100,
        );
        // A password set anywhere (profile, reset, wp_set_password) ends every identity sign-in.
        $passwordChanged = static function ($user): void {
            $uid = $user instanceof \WP_User ? (int) $user->ID : (int) $user;
            if ($uid > 0 && self::$db->row("SELECT wp_user_id FROM " . self::$db->prefix . "accounts WHERE wp_user_id=%d", $uid)) {
                self::$sessions->revoke($uid);
            }
        };
        add_action("wp_set_password", static fn ($password, $uid) => $passwordChanged((int) $uid), 10, 2);
        add_action("after_password_reset", static fn ($user) => $passwordChanged($user));
        add_action("profile_update", static function ($uid, $old) use ($passwordChanged): void {
            $now = get_userdata((int) $uid);
            if ($now && $old instanceof \WP_User && $now->user_pass !== $old->user_pass) {
                $passwordChanged((int) $uid);
            }
        }, 10, 2);
        // Guests can't plant WordPress credentials (password, application passwords) a former
        // holder of the guest could keep after an upgrade: those belong to saved accounts.
        add_filter("wp_is_application_passwords_available_for_user", static fn ($available, $user) => $available && !($user instanceof \WP_User && in_array("zero_guest", (array) $user->roles, true)), 10, 2);
        // Core's users controller ignores an error from rest_pre_insert_user on update, so stop
        // the request before its callback runs.
        add_filter("rest_request_before_callbacks", static function ($response, $handler, $request) {
            if (!$request instanceof \WP_REST_Request || $request->get_param("password") === null
                || !preg_match('#^/wp/v2/users/(me|\d+)$#', $request->get_route(), $m)) {
                return $response;
            }
            $id = $m[1] === "me" ? get_current_user_id() : (int) $m[1];
            return $id > 0 && Accounts::isGuest($id)
                ? new \WP_Error("guest_account", "Add your email first to save this account.", ["status" => 403])
                : $response;
        }, 10, 3);
        add_action("user_profile_update_errors", static function ($errors, $update, $user) {
            if ($update && !empty($user->user_pass) && Accounts::isGuest((int) $user->ID)) {
                $errors->add("guest_account", "Add your email first to save this account.");
            }
        }, 10, 3);
        // Access tokens on the REST API (`Authorization: Bearer`), after core's own resolvers.
        add_filter("determine_current_user", [Bearer::class, "resolve"], 20);
        add_filter("rest_authentication_errors", [Bearer::class, "errors"], 20);
        add_action(
            "zero_identity_maintenance",
            fn() => (new Maintenance(self::$db, self::$security))->run(),
        );
        add_filter("wp_privacy_personal_data_exporters", static function (
            $exporters,
        ) {
            $exporters["zero-identity"] = [
                "exporter_friendly_name" => "Identity",
                "callback" => static function ($email) {
                    $uid = self::$accounts->owner($email);
                    return [
                        "data" => $uid
                            ? [
                                [
                                    "group_id" => "identity",
                                    "group_label" => "Identity account",
                                    "item_id" => "identity-" . $uid,
                                    "data" => [
                                        [
                                            "name" => "Account",
                                            "value" => wp_json_encode(
                                                (new Privacy(
                                                    self::$db,
                                                    self::$security,
                                                ))->export($uid),
                                            ),
                                        ],
                                    ],
                                ],
                            ]
                            : [],
                        "done" => true,
                    ];
                },
            ];
            return $exporters;
        });
        add_filter("wp_privacy_personal_data_erasers", static function (
            $erasers,
        ) {
            $erasers["zero-identity"] = [
                "eraser_friendly_name" => "Identity",
                "callback" => static function ($email) {
                    $uid = self::$accounts->owner($email);
                    if (!$uid) {
                        return [
                            "items_removed" => false,
                            "items_retained" => false,
                            "messages" => [],
                            "done" => true,
                        ];
                    }
                    try {
                        (new Privacy(self::$db, self::$security))->erase($uid);
                        return [
                            "items_removed" => true,
                            "items_retained" => false,
                            "messages" => [
                                "Identity data erased; authored content retains an anonymous WordPress author.",
                            ],
                            "done" => true,
                        ];
                    } catch (Failure $e) {
                        return [
                            "items_removed" => false,
                            "items_retained" => true,
                            "messages" => [$e->getMessage()],
                            "done" => true,
                        ];
                    }
                },
            ];
            return $erasers;
        });
        add_action("wp_abilities_api_init", static function () {
            if (function_exists("wp_register_ability")) {
                wp_register_ability("zero-identity/account", [
                    "label" => "Get identity account",
                    "description" => "Read a WordPress identity account.",
                    "input_schema" => [
                        "type" => "object",
                        "properties" => ["id" => ["type" => "integer"]],
                        "required" => ["id"],
                    ],
                    "permission_callback" => fn() => current_user_can(
                        "list_users",
                    ),
                    "execute_callback" => fn(
                        $input,
                    ) => self::$accounts->profile((int) $input["id"]),
                ]);
            }
        });
        if (defined("WP_CLI") && WP_CLI) {
            \WP_CLI::add_command("zero-identity", new Cli());
            \WP_CLI::add_command("zero-identity app", new AppCli());
        }
    }
    /** The issuer's URL path (`/identity`, or `/blog/identity` under a subdirectory install). */
    public static function path(): string
    {
        return untrailingslashit((string) wp_parse_url(home_url("/identity"), PHP_URL_PATH));
    }
    /** Echo CORS headers for an enabled application's registered origin (`applications.origins`). */
    private static function cors(bool $credentials): void
    {
        $origin = (string) ($_SERVER["HTTP_ORIGIN"] ?? "");
        header("Vary: Origin", false);
        if (!OAuth::allowedOrigin(self::$db, $origin)) {
            return;
        }
        header("Access-Control-Allow-Origin: " . $origin);
        header("Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS");
        header("Access-Control-Allow-Headers: content-type, authorization, x-identity-csrf");
        header("Access-Control-Max-Age: 600");
        if ($credentials) {
            header("Access-Control-Allow-Credentials: true");
        }
    }
    private static function json(array $data, int $status = 200): never
    {
        status_header($status);
        header("Content-Type: application/json");
        header("Cache-Control: no-store");
        echo wp_json_encode($data);
        exit();
    }
    private static function page(string $file): void
    {
        $path = wp_parse_url($_SERVER["REQUEST_URI"] ?? "/", PHP_URL_PATH);
        $base = wp_parse_url(home_url("/identity"), PHP_URL_PATH);
        if (
            $path !== "/.well-known/openid-configuration" &&
            !str_starts_with($path, $base)
        ) {
            return;
        }
        $canonical = wp_parse_url(home_url());
        $canonicalHost =
            $canonical["host"] .
            (isset($canonical["port"]) ? ":" . $canonical["port"] : "");
        if (($_SERVER["HTTP_HOST"] ?? "") !== $canonicalHost) {
            wp_safe_redirect(
                $canonical["scheme"] .
                    "://" .
                    $canonicalHost .
                    ($_SERVER["REQUEST_URI"] ?? "/identity"),
                303,
            );
            exit();
        }
        if (
            !is_ssl() &&
            !(
                defined("ZERO_IDENTITY_DEV_HTTP") &&
                ZERO_IDENTITY_DEV_HTTP &&
                wp_get_environment_type() === "local"
            )
        ) {
            self::json(["error" => "https_required"], 400);
        }
        nocache_headers();
        header("Referrer-Policy: same-origin");
        header("X-Content-Type-Options: nosniff");
        header("X-Frame-Options: DENY");
        try {
            $route = substr($path, strlen($base));
            if (
                $path === "/.well-known/openid-configuration" ||
                $route === "/.well-known/openid-configuration"
            ) {
                self::json(OAuth::discovery());
            }
            if ($route === "/jwks") {
                self::json(Keys::jwks());
            }
            if (in_array($route, ["/token", "/revoke", "/handoff"], true)) {
                // Public clients call these from their own origin: no cookies, no credentials.
                self::cors(false);
                if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") {
                    status_header(204);
                    exit();
                }
                if ($_SERVER["REQUEST_METHOD"] !== "POST") {
                    self::json(["error" => "invalid_request"], 405);
                }
                self::$security->limit(
                    "token:" . ($_SERVER["REMOTE_ADDR"] ?? ""),
                    60,
                );
                $oauth = new OAuth(self::$db, self::$accounts);
                if ($route === "/handoff") {
                    $authorization = (string) ($_SERVER["HTTP_AUTHORIZATION"] ?? "");
                    self::json(["handoff" => $oauth->handoff(str_starts_with($authorization, "Bearer ") ? substr($authorization, 7) : "")]);
                }
                if ($route === "/revoke") {
                    $oauth->revoke(
                        is_string($_POST["token"] ?? null) ? $_POST["token"] : "",
                        is_string($_POST["client_id"] ?? null) ? $_POST["client_id"] : "",
                    );
                    self::json([]);
                }
                header("Pragma: no-cache");
                self::json($oauth->token($_POST));
            }
            if ($route === "/userinfo") {
                $authorization = $_SERVER["HTTP_AUTHORIZATION"] ?? "";
                if (!str_starts_with($authorization, "Bearer ")) {
                    self::json(["error" => "invalid_token"], 401);
                }
                self::json(
                    (new OAuth(self::$db, self::$accounts))->userinfo(
                        substr($authorization, 7),
                    ),
                );
            }
            if ($route === "/logout") {
                $query = $_SERVER["REQUEST_METHOD"] === "POST" ? $_POST : $_GET;
                $target = (new OAuth(self::$db, self::$accounts))->logout($query);
                Sessions::cookie("", time() - 3600);
                wp_redirect($target, 303);
                exit();
            }
            if ($route === "/provider/start") {
                $name = sanitize_key($_GET["provider"] ?? "");
                $url = (new Providers(
                    self::$security,
                    self::$accounts,
                    self::$sessions,
                ))->start($name, null, [], (string) ($_GET["return_to"] ?? ""));
                wp_redirect($url);
                exit();
            }
            if ($route === "/provider/callback") {
                $signedIn = (new Providers(
                    self::$security,
                    self::$accounts,
                    self::$sessions,
                ))->callback(sanitize_key($_GET["provider"] ?? ""));
                $result = self::$api->providerLogin($signedIn["uid"]);
                // A pending application authorization continues after the provider (and MFA).
                $params = array_filter([
                    "factor" => $result["kind"] === "mfa_required" ? $result["challenge_id"] : null,
                    "return_to" => $signedIn["return_to"] ?: null,
                    // A reauthentication resumes through its browser-bound cookie after the factor.
                    "reauth" => $signedIn["return_to"] === "/authorize?resume=1" ? "1" : null,
                ]);
                if ($result["kind"] === "signed_in" && $signedIn["return_to"] !== "") {
                    wp_safe_redirect(home_url("/identity" . $signedIn["return_to"]));
                    exit();
                }
                wp_safe_redirect(home_url("/identity") . ($params ? "?" . http_build_query($params) : ""));
                exit();
            }
            if ($route === "/authorize") {
                $query = $_SERVER["REQUEST_METHOD"] === "POST" ? $_POST : $_GET;
                if (isset($query["resume"])) {
                    [$resumeId, $resumeSecret] = array_pad(
                        explode(
                            ".",
                            (string) ($_COOKIE["zi_reauth"] ?? ""),
                            2,
                        ),
                        2,
                        "",
                    );
                    $resume = self::$security->consume(
                        $resumeId,
                        "authorize_reauth",
                        $resumeSecret,
                    );
                    $freshSession = self::$sessions->require();
                    if (
                        $freshSession["id"] ===
                            $resume["payload"]["prior_session"] ||
                        (int) $freshSession["created_at"] <
                            $resume["payload"]["requested_at"]
                    ) {
                        throw new Failure(
                            "login_required",
                            "A fresh sign-in is required.",
                            401,
                        );
                    }
                    $query = $resume["payload"]["query"];
                    $query["prompt"] = "consent";
                    unset($query["max_age"]);
                }
                $oauth = new OAuth(self::$db, self::$accounts);
                $handoff = is_string($query["handoff"] ?? null) ? $query["handoff"] : null;
                unset($query["handoff"]);
                $auth = $oauth->authorization($query);
                if ($handoff !== null && $_SERVER["REQUEST_METHOD"] === "GET") {
                    // A guest arrives from its app: sign this browser in as that guest, then let
                    // the hosted screen attach an email before consenting.
                    $created = $oauth->redeemHandoff($handoff);
                    Sessions::cookie($created["secret"], $created["session"]["expires_at"]);
                    wp_safe_redirect(
                        home_url(
                            "/identity?upgrade=1&return_to=" .
                                rawurlencode("/authorize?" . http_build_query($query)),
                        ),
                    );
                    exit();
                }
                $session = self::$sessions->find(
                    (string) ($_COOKIE[Sessions::COOKIE] ?? ""),
                );
                if (
                    $_SERVER["REQUEST_METHOD"] === "GET" &&
                    (($query["prompt"] ?? "") === "login" ||
                        (isset($query["max_age"]) &&
                            (!$session ||
                                (int) $session["verified_at"] <
                                    time() - (int) $query["max_age"])))
                ) {
                    $binding = Security::token();
                    $resumeId = self::$security->challenge(
                        "authorize_reauth",
                        0,
                        "",
                        [
                            "query" => $query,
                            "prior_session" => $session["id"] ?? "",
                            "requested_at" => time(),
                        ],
                        $binding,
                    );
                    setcookie("zi_reauth", $resumeId . "." . $binding, [
                        "expires" => time() + 300,
                        "path" => self::path(),
                        "secure" => is_ssl(),
                        "httponly" => true,
                        "samesite" => "Lax",
                    ]);
                    wp_safe_redirect(home_url("/identity?reauth=1"));
                    exit();
                }
                if (!$session) {
                    wp_safe_redirect(
                        home_url(
                            "/identity?return_to=" .
                                rawurlencode(
                                    "/authorize?" . http_build_query($query),
                                ),
                        ),
                    );
                    exit();
                }
                if ($_SERVER["REQUEST_METHOD"] === "POST") {
                    Api::checkOrigin(
                        (string) ($_SERVER["HTTP_ORIGIN"] ?? ""),
                        true,
                    );
                    self::$sessions->require(
                        is_string($_POST["csrf"] ?? null) ? $_POST["csrf"] : "",
                    );
                    if (
                        isset($query["max_age"]) &&
                        (!ctype_digit((string) $query["max_age"]) ||
                            (int) $session["verified_at"] <
                                time() - (int) $query["max_age"])
                    ) {
                        throw new Failure(
                            "login_required",
                            "Confirm your identity in Account, then retry.",
                            401,
                        );
                    }
                    $url = $oauth->authorize($query, $session);
                    wp_redirect($url);
                    exit();
                }
                status_header(200);
                echo '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Authorize application</title><link rel="stylesheet" href="' .
                    esc_url(plugins_url("build/hosted.css", $file)) .
                    '"></head><body><main class="consent"><div class="brand">' .
                    esc_html(get_bloginfo("name")) .
                    "</div><h1>Continue to " .
                    esc_html($auth["client"]["name"]) .
                    "</h1><p>This application will receive your identity and the profile fields you approve.</p><p>Requested: " .
                    esc_html(implode(", ", $auth["scopes"])) .
                    '</p><form method="post">';
                foreach ($query as $key => $value) {
                    if (is_string($value)) {
                        echo '<input type="hidden" name="' .
                            esc_attr($key) .
                            '" value="' .
                            esc_attr($value) .
                            '">';
                    }
                }
                echo '<input type="hidden" name="csrf" value="' .
                    esc_attr($session["csrf"]) .
                    '"><button>Allow and continue</button></form><a href="' .
                    esc_url(home_url("/identity")) .
                    '">Cancel</a></main></body></html>';
                exit();
            }
            if (!in_array($route, ["", "/", "/account"], true)) {
                self::json(["error" => "not_found"], 404);
            }
            status_header(200);
            echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' .
                esc_html(get_bloginfo("name")) .
                '</title><link rel="stylesheet" href="' .
                esc_url(plugins_url("build/hosted.css", $file)) .
                '"></head><body><div id="identity-root" data-api="' .
                esc_url(rest_url("zero-identity/v1/")) .
                '" data-issuer="' .
                esc_url(OAuth::issuer()) .
                '" data-site="' .
                esc_attr(get_bloginfo("name")) .
                '"></div><script type="module" src="' .
                esc_url(plugins_url("build/hosted.js", $file)) .
                '"></script></body></html>';
            exit();
        } catch (Protocol\OAuthError $e) {
            self::json($e->body(), $e->status);
        } catch (Failure $e) {
            self::json(
                ["error" => $e->kind, "error_description" => $e->getMessage()],
                $e->status,
            );
        } catch (\Throwable $e) {
            error_log(
                "Identity protocol: " . get_class($e) . " " . $e->getMessage(),
            );
            self::json(["error" => "server_error"], 500);
        }
    }
    private static function adminPage(string $file): void
    {
        echo '<div id="identity-admin" data-api="' .
            esc_url(rest_url("zero-identity/v1/admin/")) .
            '" data-nonce="' .
            esc_attr(wp_create_nonce("wp_rest")) .
            '" data-site="' .
            esc_attr(get_bloginfo("name")) .
            '"></div>';
        wp_enqueue_style(
            "zero-identity-admin",
            plugins_url("build/admin.css", $file),
            [],
            self::VERSION,
        );
        wp_enqueue_script(
            "zero-identity-admin",
            plugins_url("build/admin.js", $file),
            [],
            self::VERSION,
            true,
        );
    }
}
