# Admin verification

Checked against Studio at `http://localhost:8896` on 2026-11-08, using the
generated artifact from main `b66e98b3866037061198c51ebef9534609a5e301`.

An isolated headless Chromium process signed in through `/wp-login.php` with
the disposable Studio administrator. The user's browser was not used.

| Route | Observation |
| --- | --- |
| `/wp-admin/edit.php?post_type=zero_tasks` | Native list showed the sample maintenance tasks. Captured `screenshots/wp-admin-list.png`. |
| `/wp-admin/post.php?post=10&action=edit` | Classic system editor showed SCF fields for owner, room, kind, make, model, installation date, and manual ID. Captured `screenshots/wp-admin-edit.png`. |
| `/zero-admin/`, then Maintenance tasks | Zero Admin loaded the owner-visible task list. Captured `screenshots/zero-admin.png`. |
| `/wp-admin/post-new.php?post_type=zero_systems` | Creating a system without entering its automatic owner was blocked by browser required-field validation. |

For the creation check, the browser filled the title with `Kitchen dishwasher`,
room with `Kitchen`, and kind with `appliance`, then clicked Publish. The
Owner field reported:

```json
{"required":true,"value":"","valid":false,"message":"Please fill out this field."}
```

The page remained on the new-post route. The SCF field requires a value before
the request can reach the app's `beforeCreate` hook, which sets `ownerId` from
the signed-in user. The example leaves that ownership mechanism intact and
records this as a main runtime/editor gap. Native form creation is not verified.

The REST script creates the sample records used in the screenshots. Successful
REST CRUD does not establish successful creation through the native form.
