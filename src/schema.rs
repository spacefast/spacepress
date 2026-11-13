//! The evaluated schema: plain data produced by running `first.config.ts` at
//! build time. Migrations, schema.php, the typed client, and generated types
//! all derive from it.

use indexmap::IndexMap;
use serde_json::Value as Json;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColType {
    Integer,
    Real,
    Text,
    Boolean,
    Timestamp,
    Date,
    Json,
    Email,
    Url,
    Slug,
    RichText,
    Media,
    File,
    MediaList,
    /// `select([...]).many()`. A single select is `Text` with `enum`.
    Select,
    Group,
    Repeater,
    Blocks,
}

impl ColType {
    pub fn name(self) -> &'static str {
        match self {
            ColType::Integer => "integer",
            ColType::Real => "real",
            ColType::Text => "text",
            ColType::Boolean => "boolean",
            ColType::Timestamp => "timestamp",
            ColType::Date => "date",
            ColType::Json => "json",
            ColType::Email => "email",
            ColType::Url => "url",
            ColType::Slug => "slug",
            ColType::RichText => "richText",
            ColType::Media => "media",
            ColType::File => "file",
            ColType::MediaList => "mediaList",
            ColType::Select => "select",
            ColType::Group => "group",
            ColType::Repeater => "repeater",
            ColType::Blocks => "blocks",
        }
    }

    /// The authoring name: the builder (`number()`) and its kind in the `"first"` types. `name()` is
    /// the stored name, which the snapshot and schema.php keep.
    pub fn builder_name(self) -> &'static str {
        match self {
            ColType::Real => "number",
            other => other.name(),
        }
    }

    /// Strings validated by length/pattern.
    pub fn is_stringy(self) -> bool {
        matches!(self, ColType::Text | ColType::Email | ColType::Url | ColType::Slug)
    }

    /// Stored as JSON text and filtered as a whole value (§3.5 `json` kind).
    pub fn is_json_kind(self) -> bool {
        matches!(
            self,
            ColType::Json | ColType::Group | ColType::Repeater | ColType::Blocks
        )
    }

    /// Lists filtered with `has` (§3.5 `serialized-list` kind).
    pub fn is_list_kind(self) -> bool {
        matches!(self, ColType::MediaList | ColType::Select)
    }

    /// Group/repeater/blocks: their meta is spread over many rows on WordPress.
    pub fn is_structured(self) -> bool {
        matches!(self, ColType::Group | ColType::Repeater | ColType::Blocks)
    }
}

/// How a column gets a value when the writer leaves it out.
#[derive(Debug, Clone, PartialEq)]
pub enum DefaultKind {
    /// A constant, already in the column's JSON input shape.
    Value(Json),
    /// Current UTC timestamp (or today's date for `date`).
    Now,
    /// A compiled PHP function in functions.php (name without namespace).
    Fn(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefAction {
    Cascade,
    Restrict,
    SetNull,
    NoAction,
}

impl RefAction {
    pub fn sql(self) -> &'static str {
        match self {
            RefAction::Cascade => "cascade",
            RefAction::Restrict => "restrict",
            RefAction::SetNull => "set null",
            RefAction::NoAction => "no action",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Reference {
    /// Target collection's table name.
    pub collection: String,
    pub column: String,
    pub on_delete: Option<RefAction>,
    pub on_update: Option<RefAction>,
}

/// Value rules checked by the runtime after coercion (§1.2).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Rules {
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// JavaScript source and flags of a RegExp literal.
    pub pattern: Option<(String, String)>,
    /// Compiled validator (function name in functions.php).
    pub validate: Option<String>,
}

impl Rules {
    pub fn is_empty(&self) -> bool {
        self.min.is_none() && self.max.is_none() && self.pattern.is_none() && self.validate.is_none()
    }
}

/// Presentation only: never part of storage, validation or authorization.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FieldUi {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u8>,
}

#[derive(Debug, Clone)]
pub struct Column {
    pub name: String,
    pub ty: ColType,
    pub not_null: bool,
    pub primary_key: bool,
    pub auto_increment: bool,
    pub unique: bool,
    pub enum_values: Option<Vec<String>>,
    pub multiline: bool,
    /// `media({ accept })`: "image" | "any".
    pub accept: Option<String>,
    /// `slug({ source })`.
    pub source: Option<String>,
    pub default: Option<DefaultKind>,
    pub on_update: Option<DefaultKind>,
    pub references: Option<Reference>,
    pub rules: Rules,
    /// Sub-fields of a group or repeater.
    pub fields: Option<IndexMap<String, Column>>,
    /// Layouts of a blocks column: layout name → sub-fields.
    pub layouts: Option<IndexMap<String, IndexMap<String, Column>>>,
    /// Added by the compiler (drafts `status` / `publishedAt`).
    pub system: bool,
    pub localized: bool,
    pub access: IndexMap<String, Access>,
    pub show_if: Option<Json>,
    pub ui: Option<FieldUi>,
    pub bucket: Option<String>,
    pub derived: bool,
    pub hidden: bool,
    /// `json<T>()` annotation, module and call position.
    pub ts_type: Option<(crate::ir::TyAnn, usize, crate::diag::Span)>,
    /// `.was("old")`: the stored name before a rename (spec §2.5).
    pub was: Option<String>,
}

impl Column {
    pub fn new(name: &str, ty: ColType) -> Column {
        Column {
            name: name.to_string(),
            ty,
            not_null: false,
            primary_key: false,
            auto_increment: false,
            unique: false,
            enum_values: None,
            multiline: false,
            accept: None,
            source: None,
            default: None,
            on_update: None,
            references: None,
            rules: Rules::default(),
            fields: None,
            layouts: None,
            system: false,
            localized: false,
            access: IndexMap::new(),
            show_if: None,
            ui: None,
            bucket: None,
            derived: false,
            hidden: false,
            ts_type: None,
            was: None,
        }
    }

    /// §7.3: translated per locale when it or any sub-field is `.localized()`; otherwise synced.
    pub fn translated(&self) -> bool {
        self.localized
            || self
                .fields
                .as_ref()
                .is_some_and(|fs| fs.values().any(Column::translated))
            || self
                .layouts
                .as_ref()
                .is_some_and(|ls| ls.values().any(|fs| fs.values().any(Column::translated)))
    }

    /// The declaration model describes generated values, not nullable backing storage.
    pub fn authored_not_null(&self) -> bool {
        self.not_null || self.derived || self.system && self.name == "uid"
    }

    pub fn authored_has_default(&self) -> bool {
        self.default.is_some()
            || self.auto_increment
            || self.derived
            || self.system && self.name == "uid"
            || self.ty == ColType::Slug && self.source.is_some()
    }

    /// Writers may omit it on insert.
    pub fn optional_on_insert(&self) -> bool {
        !self.not_null || self.default.is_some() || self.auto_increment
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelKind {
    One,
    Many,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Relation {
    pub name: String,
    pub kind: RelKind,
    /// Target table name.
    pub collection: String,
    pub from: String,
    pub to: String,
    pub optional: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HookKind {
    BeforeCreate,
    AfterCreate,
    BeforeUpdate,
    AfterUpdate,
    BeforeDelete,
    AfterDelete,
}

impl HookKind {
    pub const ALL: [HookKind; 6] = [
        HookKind::BeforeCreate,
        HookKind::AfterCreate,
        HookKind::BeforeUpdate,
        HookKind::AfterUpdate,
        HookKind::BeforeDelete,
        HookKind::AfterDelete,
    ];

    pub fn name(self) -> &'static str {
        match self {
            HookKind::BeforeCreate => "beforeCreate",
            HookKind::AfterCreate => "afterCreate",
            HookKind::BeforeUpdate => "beforeUpdate",
            HookKind::AfterUpdate => "afterUpdate",
            HookKind::BeforeDelete => "beforeDelete",
            HookKind::AfterDelete => "afterDelete",
        }
    }

    pub fn parse(s: &str) -> Option<HookKind> {
        HookKind::ALL.into_iter().find(|h| h.name() == s)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Api {
    pub list: bool,
    pub get: bool,
    pub create: bool,
    pub update: bool,
    pub delete: bool,
}

pub const ROLES: [&str; 5] = ["guest", "subscriber", "author", "editor", "admin"];

/// One access rule (§1.6), as schema.php stores it.
#[derive(Debug, Clone, PartialEq)]
pub enum Access {
    Allow(bool),
    Self_,
    Owner,
    /// "anyone" | "authenticated" | a role.
    Role(String),
    /// Compiled function name.
    Fn(String),
}

impl Access {
    pub fn editor() -> Access {
        Access::Role("editor".into())
    }
    pub fn anyone() -> Access {
        Access::Role("anyone".into())
    }
}

/// Operations a collection's access config covers, in schema.php order.
pub const ACCESS_OPS: [&str; 4] = ["read", "create", "update", "delete"];

#[derive(Debug, Clone)]
pub struct Collection {
    /// Logical registry key in the config (`shoppingList`).
    pub key: String,
    /// Derived physical name and REST path segment (`shopping_list`).
    pub table: String,
    /// Exact SQL table binding, without the WordPress prefix. Must already exist.
    pub existing_table: Option<String>,
    /// `was: "old"`: the stored name before a rename (spec §2.6).
    pub was: Option<String>,
    pub label: String,
    pub editor: bool,
    pub drafts: bool,
    pub revisions: bool,
    /// `staged: false` turns staged versions off for a collection (they need its revisions).
    pub staged: bool,
    /// `comments: true`: the post type supports WordPress comments; every other kind has them off.
    pub comments: bool,
    pub title: Option<String>,
    pub content: Option<String>,
    pub slug: Option<String>,
    pub columns: IndexMap<String, Column>,
    pub relations: IndexMap<String, Relation>,
    /// Hook → compiled PHP function name.
    pub hooks: IndexMap<HookKind, String>,
    /// Required columns the beforeCreate hook assigns (checked after the hook).
    pub before_create_fills: Vec<String>,
    /// op ("read" | "create" | "update" | "delete") → rule.
    pub access: IndexMap<String, Access>,
    pub api: Api,
    pub uid: bool,
    pub sync: Option<Json>,
    pub auth: bool,
    pub agents: bool,
    pub localized: bool,
    /// `url: "/blog/:slug"`: the pattern as written (spec §2.7). Checked by [`crate::kind_url`].
    pub url: Option<String>,
}

impl Collection {
    pub fn primary_key(&self) -> Option<&Column> {
        self.columns.values().find(|c| c.primary_key)
    }

    /// Is this column a WordPress core post column (not postmeta) on WP?
    pub fn is_core_column(&self, col: &str) -> bool {
        self.columns.get(col).is_some_and(|c| c.primary_key || c.system)
            || self.title.as_deref() == Some(col)
            || self.content.as_deref() == Some(col)
            || self.slug.as_deref() == Some(col)
    }
}

#[derive(Debug, Clone)]
pub struct Action {
    pub name: String,
    pub input: IndexMap<String, Column>,
    pub handler: String,
    pub access: Access,
    pub agents: bool,
    pub idempotent: bool,
    /// Reads only: the Ability runs over GET, and the facade serves `GET /actions/<name>`.
    pub readonly: bool,
    /// Removes or overwrites data an agent should confirm first (the Ability's `destructive`).
    pub destructive: bool,
    pub signature: Option<Json>,
    /// The handler's result as a JSON Schema, from its TypeScript return type (filled after compile).
    pub output: Option<Json>,
}

/// One `wp-hooks/` handler, registered with `add_filter`/`add_action`.
#[derive(Debug, Clone)]
pub struct WpHook {
    pub hook: String,
    pub filter: bool,
    pub priority: i64,
    pub args: usize,
    pub handler: String,
}

#[derive(Debug, Clone)]
pub struct Job {
    pub input: IndexMap<String, Column>,
    pub handler: String,
    pub retries: u32,
    pub agents: bool,
}

#[derive(Debug, Clone)]
pub struct FileBucket {
    pub accept: Vec<String>,
    pub max_bytes: u64,
    pub access: IndexMap<String, Access>,
}

#[derive(Debug, Clone)]
pub struct Global {
    pub name: String,
    pub label: String,
    pub agents: bool,
    pub fields: IndexMap<String, Column>,
    /// "read" / "update" → rule.
    pub access: IndexMap<String, Access>,
}

/// Where a column lives, for attaching compiled functions after evaluation.
#[derive(Debug, Clone, PartialEq)]
pub enum Owner {
    Collection(String),
    Global(String),
    Action(String),
    Job(String),
    FileBucket(String),
}

/// A column (or a sub-field of one): `[col]`, `[col, sub]`, `[col, layout, sub]`, ...
#[derive(Debug, Clone, PartialEq)]
pub struct ColPath {
    pub owner: Owner,
    pub path: Vec<String>,
}

/// The whole app, keyed by table name.
#[derive(Debug, Clone)]
pub struct Schema {
    pub name: String,
    pub collections: IndexMap<String, Collection>,
    pub globals: IndexMap<String, Global>,
    pub actions: IndexMap<String, Action>,
    pub jobs: IndexMap<String, Job>,
    /// `wp-hooks/` handlers, in registration order.
    pub wp_hooks: Vec<WpHook>,
    /// Server components (`first/components/<file>.tsx#<export>`) → their compiled PHP function.
    pub components: IndexMap<String, String>,
    /// `"use client"` components (generator B): namespace → its store module.
    pub islands: IndexMap<String, Island>,
    /// Imported stylesheets and images (`crate::assets`), by output file name below
    /// `first/app/assets/`.
    pub assets: IndexMap<String, Vec<u8>>,
    /// `first/app/`: the route table and each route file's compiled exports (docs/spec/rendering.md).
    pub app: Option<App>,
    /// Hooks or WordPress functions hand `WP_Post`/`WP_User` views to compiled code.
    pub wp_views: bool,
    pub files: IndexMap<String, FileBucket>,
    pub webhooks: Vec<Json>,
    pub media: Json,
    pub uploads: Option<Json>,
    pub locales: Option<Json>,
    /// `defineConfig({ admin: true })`: the build ships the optional admin screens plugin.
    pub admin: bool,
    /// `defineConfig({ frontend })` (spec §5); `None` is the default: the theme, or `first/app`.
    pub frontend: Option<crate::kind_url::Frontend>,
}

impl Default for Schema {
    fn default() -> Self {
        Schema {
            name: String::new(),
            collections: IndexMap::new(),
            globals: IndexMap::new(),
            actions: IndexMap::new(),
            jobs: IndexMap::new(),
            wp_hooks: Vec::new(),
            components: IndexMap::new(),
            app: None,
            islands: IndexMap::new(),
            assets: IndexMap::new(),
            wp_views: false,
            files: IndexMap::new(),
            webhooks: Vec::new(),
            media: serde_json::json!({"sizes": {}}),
            uploads: None,
            locales: None,
            admin: false,
            frontend: None,
        }
    }
}

impl Schema {
    pub fn by_key(&self, key: &str) -> Option<&Collection> {
        self.collections.values().find(|c| c.key == key)
    }

    /// The column a path names. Paths come from the extractor, so they always resolve.
    pub fn column_at(&self, at: &ColPath) -> &Column {
        let top = match &at.owner {
            Owner::Collection(t) => &self.collections[t].columns,
            Owner::Global(g) => &self.globals[g].fields,
            Owner::Action(a) => &self.actions[a].input,
            Owner::Job(j) => &self.jobs[j].input,
            Owner::FileBucket(_) => unreachable!("buckets have no columns"),
        };
        let mut col = &top[&at.path[0]];
        let mut rest = &at.path[1..];
        while !rest.is_empty() {
            if let Some(layouts) = &col.layouts {
                col = &layouts[&rest[0]][&rest[1]];
                rest = &rest[2..];
            } else {
                col = &col.fields.as_ref().expect("sub-fields")[&rest[0]];
                rest = &rest[1..];
            }
        }
        col
    }

    pub fn column_mut(&mut self, at: &ColPath) -> &mut Column {
        let top = match &at.owner {
            Owner::Collection(t) => &mut self.collections.get_mut(t).expect("collection").columns,
            Owner::Global(g) => &mut self.globals.get_mut(g).expect("global").fields,
            Owner::Action(a) => &mut self.actions.get_mut(a).expect("action").input,
            Owner::Job(j) => &mut self.jobs.get_mut(j).expect("job").input,
            Owner::FileBucket(_) => unreachable!("buckets have no columns"),
        };
        let mut col = top.get_mut(&at.path[0]).expect("column");
        let mut rest = &at.path[1..];
        while !rest.is_empty() {
            if let Some(layouts) = col.layouts.as_mut() {
                col = layouts
                    .get_mut(&rest[0])
                    .expect("layout")
                    .get_mut(&rest[1])
                    .expect("layout field");
                rest = &rest[2..];
            } else {
                col = col
                    .fields
                    .as_mut()
                    .expect("sub-fields")
                    .get_mut(&rest[0])
                    .expect("sub-field");
                rest = &rest[1..];
            }
        }
        col
    }
}

/// "shopping_list" → "Shopping List".
pub fn title_case(name: &str) -> String {
    name.split(['_', '-'])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// A registry key has one deterministic storage/route identity. Split camel case,
/// retaining existing snake-case names and acronym boundaries.
pub fn physical_name(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    let mut out = String::new();
    for (i, c) in chars.iter().enumerate() {
        if c.is_ascii_uppercase()
            && i > 0
            && chars[i - 1] != '_'
            && (chars[i - 1].is_ascii_lowercase()
                || chars[i - 1].is_ascii_digit()
                || chars.get(i + 1).is_some_and(char::is_ascii_lowercase))
        {
            out.push('_');
        }
        out.push(c.to_ascii_lowercase());
    }
    out
}

/// `first/app/` as the runtime router reads it.
#[derive(Debug, Clone, Default)]
pub struct App {
    /// Most specific first: the router takes the first match.
    pub routes: Vec<AppRoute>,
    pub not_found: Option<AppRoute>,
    /// Route file (relative to `first/`) → its compiled exports.
    pub files: IndexMap<String, AppFile>,
    /// Content-owned pages (`page.md`), by route id: what the site stores as a WordPress Page.
    pub content: IndexMap<String, crate::content_page::Page>,
    /// The table is a 0.3.0 capture's `routes` config (`extract::legacy::routes`), served as 0.3.0
    /// served it: matched per method, reads trusted, the front end left to the theme.
    pub legacy_routes: bool,
}

#[derive(Debug, Clone)]
pub struct AppRoute {
    /// The folder below `app/`, `/` for the root: stable across builds.
    pub id: String,
    /// `/blog/:slug`, `/docs/*rest` (one or more), `/docs/**rest` (zero or more).
    pub pattern: String,
    pub page: Option<String>,
    pub handler: Option<String>,
    pub layouts: Vec<String>,
    pub error: Option<String>,
    /// The stylesheets the page and its layouts import, in link order (`assets::stylesheets`).
    pub styles: Vec<String>,
    /// The kind whose `url` this page serves (spec §2.7), with each pattern placeholder's folder
    /// parameter: the page receives that kind's `item`, and a missing one is a 404.
    pub kind: Option<(String, Vec<(String, String)>)>,
}

#[derive(Debug, Clone, Default)]
pub struct AppFile {
    /// The compiled default component.
    pub component: Option<String>,
    /// A literal metadata object, or `{ "fn": name }` for a function.
    pub metadata: Option<Json>,
    pub guard: Option<Access>,
    pub search: Option<AppSearch>,
    /// HTTP method → compiled handler.
    pub methods: IndexMap<String, String>,
    /// Who may call the handlers (`export const access`), or the signature that authenticates
    /// them (`export const signature`, a raw signed webhook). Exactly one when there are handlers.
    pub access: Option<Access>,
    pub signature: Option<Json>,
}

#[derive(Debug, Clone)]
pub struct AppSearch {
    pub fields: IndexMap<String, Column>,
}

/// One compiled `"use client"` component: its store module and the server actions it calls.
#[derive(Debug, Clone)]
pub struct Island {
    /// File name under the app plugin's `first/app/client/`, content-hashed.
    pub file: String,
    pub source: String,
    pub actions: Vec<String>,
}
