# WordPress plugin template

`plugin.php` is the plugin main file. `zero build --target wp` writes it as `zero-<name>.php` at the
plugin root and replaces these placeholders:

| Placeholder | Value |
|---|---|
| `{{name}}` | project name (`blog`) |
| `{{slug}}` | plugin slug, `zero-<name>` |
| `{{label}}` | title-cased name, shown as the plugin name |
| `{{version}}` | plugin version |
| `{{schemaHash}}` | fingerprint of `schema.php`; a new value re-runs migrations on `admin_init` |
| `{{zeroVersion}}` | the compiler version |

Layout the build produces (design §4.9):

```
zero-<name>/
  zero-<name>.php          this template
  zero/runtime/**          runtime/Zero/** (including Wp/)
  zero/app/schema.php      target => 'wp'
  zero/app/functions.php
  zero/app/migrations/*.sql   MySQL, `{prefix}` = $wpdb->prefix
  vendor/                  empty
```
